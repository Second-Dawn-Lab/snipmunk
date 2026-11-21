//! The rendered file of a recording (`final.mp4` in the recording's folder): the screen video with the recorded cursor drawn on it
//! and the system sound and the microphone mixed into one AAC track. Save, Copy, drag out and Share all use this file. It is made
//! the first time it is needed and used again until something it is made from changes (`cache_key`).
//!
//! The pieces that do not need Windows (drawing the cursor on a picture, mixing and resampling the tracks, the cache key) are
//! plain functions with tests. The Windows part reads the screen video with Media Foundation (a source reader that gives
//! pictures), draws the cursor on each picture, and hands pictures and sound to the H.264 + AAC encoder of the capture library.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Changes when the rendering changes in a way that makes old files wrong.
pub const RENDER_VERSION: u32 = 2;

/// The sound is rendered as 48 kHz stereo.
pub const OUT_RATE: u32 = 48_000;

/// Draw `img` (RGBA) on a BGRA picture (top row first) with its top left corner at (`x`, `y`); parts outside are cut off.
pub fn blend_cursor(frame: &mut [u8], w: u32, h: u32, img: &image::RgbaImage, x: i32, y: i32) {
    for (iy, row) in img.rows().enumerate() {
        let fy = y + iy as i32;
        if fy < 0 || fy >= h as i32 {
            continue;
        }
        for (ix, p) in row.enumerate() {
            let fx = x + ix as i32;
            if fx < 0 || fx >= w as i32 || p[3] == 0 {
                continue;
            }
            let at = (fy as usize * w as usize + fx as usize) * 4;
            let a = p[3] as u32;
            let d = &mut frame[at..at + 4];
            // BGRA <- RGBA over the picture
            d[0] = ((p[2] as u32 * a + d[0] as u32 * (255 - a) + 127) / 255) as u8;
            d[1] = ((p[1] as u32 * a + d[1] as u32 * (255 - a) + 127) / 255) as u8;
            d[2] = ((p[0] as u32 * a + d[2] as u32 * (255 - a) + 127) / 255) as u8;
            d[3] = 255;
        }
    }
}

/// One WAV track read as stereo float at 48 kHz, a piece at a time (a track of an hour is never in memory as a whole).
pub struct TrackReader {
    file: File,
    channels: usize,
    ratio: f64,
    volume: f32,
    /// Source frames that are buffered, and the index of the first of them.
    buf: VecDeque<(f32, f32)>,
    base: u64,
    /// Where the next output frame lies in the source (in source frames).
    pos: f64,
    eof: bool,
    bytes_left: u64,
}

impl TrackReader {
    pub fn open(path: &Path, volume: f32) -> io::Result<Self> {
        let mut file = File::open(path)?;
        let mut h = [0u8; 44];
        file.read_exact(&mut h)?;
        if &h[0..4] != b"RIFF"
            || u16::from_le_bytes([h[20], h[21]]) != 1
            || u16::from_le_bytes([h[34], h[35]]) != 16
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "not a 16 bit PCM wav file",
            ));
        }
        let channels = u16::from_le_bytes([h[22], h[23]]).max(1) as usize;
        let rate = u32::from_le_bytes([h[24], h[25], h[26], h[27]]).max(1);
        let size = file.metadata()?.len();
        // The header may be out of date after a crash: the size of the file counts.
        let bytes_left = size.saturating_sub(44);
        file.seek(SeekFrom::Start(44))?;
        Ok(Self {
            file,
            channels,
            ratio: rate as f64 / OUT_RATE as f64,
            volume,
            buf: VecDeque::new(),
            base: 0,
            pos: 0.0,
            eof: false,
            bytes_left,
        })
    }

    fn fill(&mut self, until: u64) {
        while !self.eof && self.base + (self.buf.len() as u64) <= until {
            let frame_bytes = self.channels * 2;
            let want =
                (frame_bytes * 4096).min(self.bytes_left as usize) / frame_bytes * frame_bytes;
            if want == 0 {
                self.eof = true;
                break;
            }
            let mut bytes = vec![0u8; want];
            if self.file.read_exact(&mut bytes).is_err() {
                self.eof = true;
                break;
            }
            self.bytes_left -= want as u64;
            for f in bytes.chunks_exact(frame_bytes) {
                let l = i16::from_le_bytes([f[0], f[1]]) as f32 / 32768.0;
                let r = if self.channels > 1 {
                    i16::from_le_bytes([f[2], f[3]]) as f32 / 32768.0
                } else {
                    l
                };
                self.buf.push_back((l, r));
            }
        }
    }

    /// The next `n` output frames (stereo, 48 kHz, volume applied); silence after the end of the track.
    pub fn next(&mut self, n: usize) -> Vec<(f32, f32)> {
        let last = (self.pos + n as f64 * self.ratio).ceil() as u64 + 1;
        self.fill(last);
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let p = self.pos + i as f64 * self.ratio;
            let i0 = p.floor() as u64;
            let frac = (p - i0 as f64) as f32;
            let get = |k: u64| -> (f32, f32) {
                k.checked_sub(self.base)
                    .and_then(|o| self.buf.get(o as usize))
                    .copied()
                    .unwrap_or((0.0, 0.0))
            };
            let (a, b) = (get(i0), get(i0 + 1));
            out.push((
                (a.0 + (b.0 - a.0) * frac) * self.volume,
                (a.1 + (b.1 - a.1) * frac) * self.volume,
            ));
        }
        self.pos += n as f64 * self.ratio;
        // What is behind the position is not needed any more.
        let keep_from = self.pos.floor() as u64;
        while self.base < keep_from && !self.buf.is_empty() {
            self.buf.pop_front();
            self.base += 1;
        }
        out
    }

    /// True when nothing of the track is left.
    #[cfg(test)]
    pub fn done(&self) -> bool {
        self.eof && self.base + self.buf.len() as u64 <= self.pos.floor() as u64 + 1
    }
}

/// Mix the tracks: the next `n` frames as 16 bit interleaved stereo bytes.
pub fn mix_next(tracks: &mut [TrackReader], n: usize) -> Vec<u8> {
    let mut sum = vec![(0.0f32, 0.0f32); n];
    for t in tracks.iter_mut() {
        for (s, v) in sum.iter_mut().zip(t.next(n)) {
            s.0 += v.0;
            s.1 += v.1;
        }
    }
    let mut out = Vec::with_capacity(n * 4);
    for (l, r) in sum {
        out.extend_from_slice(&((l.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        out.extend_from_slice(&((r.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

/// The cursor of a recording as it is drawn: positions over time and the pictures.
pub struct CursorLayer {
    /// (ms, x, y, visible, shape id)
    points: Vec<(u64, i32, i32, bool, String)>,
    shapes: std::collections::HashMap<String, (image::RgbaImage, i32, i32)>,
    /// The presses of the buttons: (ms, x, y, left?)
    clicks: Vec<(u64, f32, f32, bool)>,
}

/// How long a click effect lasts (milliseconds); the player uses the same.
pub const CLICK_MS: u64 = 600;

impl CursorLayer {
    /// Read the cursor track and its pictures from the recording folder; `None` when there is no track.
    pub fn load(dir: &Path, file: &str) -> Option<Self> {
        let track = crate::cursor::read(&dir.join(file)).ok()?;
        let mut shape = String::from("arrow");
        let points = track
            .points
            .into_iter()
            .map(|(t, x, y, v, s)| {
                if let Some(s) = s {
                    shape = s;
                }
                (t, x, y, v, shape.clone())
            })
            .collect();
        let mut shapes = std::collections::HashMap::new();
        for (id, hx, hy, _, _, f) in track.shapes {
            if let Ok(img) = image::open(dir.join(&f)) {
                shapes.insert(id, (img.to_rgba8(), hx, hy));
            }
        }
        let mut layer = Self {
            points,
            shapes,
            clicks: Vec::new(),
        };
        layer.clicks = track
            .buttons
            .iter()
            .filter(|(_, _, down)| *down)
            .map(|(t, b, _)| {
                let (x, y, _) = layer.position(*t);
                (*t, x, y, b == "l")
            })
            .collect();
        Some(layer)
    }

    /// The position (recording pixels) and visibility at `ms`, interpolated between the samples.
    pub fn position(&self, ms: u64) -> (f32, f32, bool) {
        let i = self.points.partition_point(|p| p.0 <= ms);
        let Some(a) = i
            .checked_sub(1)
            .and_then(|i| self.points.get(i))
            .or(self.points.first())
        else {
            return (0.0, 0.0, false);
        };
        let (mut x, mut y) = (a.1 as f32, a.2 as f32);
        if let Some(b) = self.points.get(i) {
            if i > 0 && b.0 > a.0 && b.3 {
                let k = ((ms - a.0) as f32 / (b.0 - a.0) as f32).clamp(0.0, 1.0);
                x += (b.1 - a.1) as f32 * k;
                y += (b.2 - a.2) as f32 * k;
            }
        }
        (x, y, a.3)
    }

    /// The click effects that are showing at `ms`: (age 0..1, x, y, left?).
    pub fn clicks_at(&self, ms: u64) -> Vec<(f32, f32, f32, bool)> {
        let from = self.clicks.partition_point(|c| c.0 + CLICK_MS <= ms);
        self.clicks[from..]
            .iter()
            .take_while(|c| c.0 <= ms)
            .map(|c| ((ms - c.0) as f32 / CLICK_MS as f32, c.1, c.2, c.3))
            .collect()
    }

    /// Draw what the effects ask for on a BGRA picture (top row first) at the time `ms`: the halo, the click effects, then the
    /// cursor itself (at the chosen size), in this order.
    pub fn draw_fx(&self, frame: &mut [u8], w: u32, h: u32, ms: u64, fx: &crate::effects::Effects) {
        use crate::compose::{blend_scaled, draw_burst, draw_halo, draw_ripple, parse_hex};
        let (wi, hi) = (w as usize, h as usize);
        let (x, y, visible) = self.position(ms);
        let scale = fx.cursor_scale();
        if fx.cursor.show && visible && fx.cursor.halo {
            draw_halo(
                frame,
                wi,
                hi,
                x,
                y,
                hi as f32 * 0.05 * scale,
                parse_hex(&fx.cursor.halo_color),
            );
        }
        if fx.click.kind != "off" {
            let radius = fx.click_radius() * hi as f32;
            for (t, cx, cy, left) in self.clicks_at(ms) {
                let rgb = parse_hex(if left {
                    &fx.click.left
                } else {
                    &fx.click.right
                });
                if fx.click.kind == "burst" {
                    draw_burst(frame, wi, hi, cx, cy, radius, t, rgb);
                } else {
                    draw_ripple(frame, wi, hi, cx, cy, radius, t, rgb);
                }
            }
        }
        if fx.cursor.show && visible {
            let shape = self
                .points
                .get(self.points.partition_point(|p| p.0 <= ms).saturating_sub(1))
                .map(|p| &p.4);
            if let Some((img, hx, hy)) = shape.and_then(|s| self.shapes.get(s)) {
                if scale == 1.0 {
                    blend_cursor(
                        frame,
                        w,
                        h,
                        img,
                        x.round() as i32 - hx,
                        y.round() as i32 - hy,
                    );
                } else {
                    blend_scaled(
                        frame,
                        wi,
                        hi,
                        img,
                        x - *hx as f32 * scale,
                        y - *hy as f32 * scale,
                        scale,
                    );
                }
            }
        }
    }
}

/// What the rendered file is made from, as text: when it changes the file is made again.
pub fn cache_key(
    dir: &Path,
    out_name: &str,
    extra: &str,
    system_volume: f32,
    mic_volume: f32,
) -> String {
    let stamp = |name: &str| -> String {
        match std::fs::metadata(dir.join(name)) {
            Ok(m) => {
                let t = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                format!("{}:{}", m.len(), t)
            }
            Err(_) => "-".to_string(),
        }
    };
    format!(
        "v{RENDER_VERSION}|dir {}|out {out_name}|{extra}|screen {}|system {}|mic {}|cursor {}|webcam {}|vol {system_volume:.2} {mic_volume:.2}",
        dir.to_string_lossy().to_lowercase(),
        stamp("screen.mp4"),
        stamp("system.wav"),
        stamp("mic.wav"),
        stamp("cursor.jsonl"),
        stamp("webcam.mp4"),
    )
}

/// The export settings and the look of the recording (cursor, click effects, webcam overlay, trim) as text, for the cache key: a
/// change of any of them makes the file again.
pub fn export_key(dir: &Path, settings: &crate::effects::ExportSettings) -> String {
    let effects = std::fs::read(dir.join("recording.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v.get("effects").map(|e| e.to_string()))
        .unwrap_or_default();
    format!("{}|{}", settings.key(), effects)
}

/// Is `final.mp4` there and made from what is there now?
pub fn is_fresh(dir: &Path, out_name: &str, key: &str) -> bool {
    dir.join(out_name).is_file()
        && std::fs::read_to_string(key_path(dir, out_name)).is_ok_and(|k| k == key)
}

/// The file with the key of a rendered file: `<name>.mp4` has `<name>.key`.
pub fn key_path(dir: &Path, out_name: &str) -> PathBuf {
    let stem = Path::new(out_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(out_name);
    dir.join(format!("{stem}.key"))
}

/// Copy a picture of `h` rows of `row` bytes out of a buffer whose rows are `stride` bytes apart (padding at the end of each
/// row) into `out`, top row first. `bottom_up`: the buffer stores the bottom row first. False when the buffer is too short.
pub fn copy_rows(
    src: &[u8],
    stride: usize,
    h: usize,
    row: usize,
    bottom_up: bool,
    out: &mut [u8],
) -> bool {
    if stride < row || out.len() < row * h || h == 0 {
        return false;
    }
    if src.len() < stride * (h - 1) + row {
        return false;
    }
    for (y, dst) in out.chunks_exact_mut(row).take(h).enumerate() {
        let from = if bottom_up { h - 1 - y } else { y } * stride;
        dst.copy_from_slice(&src[from..from + row]);
    }
    true
}

/// The real bytes per row of a flat picture buffer of `len` bytes that holds `h` visible rows of at least `stride` bytes: the
/// decoder may pad the rows and also the height (aligned to 16). Falls back to `stride` when nothing fits exactly.
pub fn infer_pitch(len: usize, stride: usize, h: usize) -> usize {
    if stride == 0 || h == 0 || len == stride * h {
        return stride;
    }
    for rows in h..=h + 64 {
        if len.is_multiple_of(rows) {
            let pitch = len / rows;
            if pitch >= stride && pitch.is_multiple_of(4) {
                return pitch;
            }
        }
    }
    stride
}

/// The rows of a BGRA picture in reverse order, written into `out` (resized when needed, reused between pictures).
pub fn flip_into(src: &[u8], w: usize, h: usize, out: &mut Vec<u8>) {
    let stride = w * 4;
    out.resize(stride * h, 0);
    for (y, dst) in out.chunks_exact_mut(stride).enumerate() {
        let from = (h - 1 - y) * stride;
        dst.copy_from_slice(&src[from..from + stride]);
    }
}

/// The layout of a flat NV12 buffer of `len` bytes for a `w` x `h` picture: (bytes per row, rows of the Y plane). The decoder
/// pads both (rows to 16..64 bytes, the height to 16); the UV plane follows the Y plane. `None` when nothing fits.
pub fn nv12_layout(len: usize, w: usize, h: usize) -> Option<(usize, usize)> {
    if w == 0 || h == 0 {
        return None;
    }
    // The usual case first: the height padded to a multiple of 16, then to 2, then anything near.
    let mut heights = vec![(h + 15) & !15, (h + 1) & !1, h];
    heights.extend(h..=h + 64);
    for ah in heights {
        if ah < h || !(len * 2).is_multiple_of(3 * ah) {
            continue;
        }
        let pitch = len * 2 / (3 * ah);
        if pitch >= w && pitch.is_multiple_of(2) {
            return Some((pitch, ah));
        }
    }
    None
}

/// Convert an NV12 picture to BGRA (top row first). `bt709`: the colour matrix; `full`: full range (0..255) instead of
/// 16..235. Rows are converted on several threads.
#[allow(clippy::too_many_arguments, clippy::chunks_exact_to_as_chunks)]
pub fn nv12_to_bgra(
    data: &[u8],
    pitch: usize,
    aligned_h: usize,
    w: usize,
    h: usize,
    bt709: bool,
    full: bool,
    out: &mut [u8],
) {
    let (y_plane, uv_plane) = data.split_at((pitch * aligned_h).min(data.len()));
    // Fixed point (x 256) coefficients: red from V, green from U and V, blue from U; and the scale / offset of Y.
    let ((rv, gu, gv, bu), (ys, yo)) = match (bt709, full) {
        (true, false) => ((459, 55, 136, 541), (298, 16)),
        (false, false) => ((409, 100, 208, 517), (298, 16)),
        (true, true) => ((403, 48, 120, 475), (256, 0)),
        (false, true) => ((359, 88, 183, 454), (256, 0)),
    };
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2)
        .clamp(1, 8);
    let band = h.div_ceil(threads).max(2) & !1;
    std::thread::scope(|scope| {
        for (bi, chunk) in out[..w * h * 4].chunks_mut(band * w * 4).enumerate() {
            scope.spawn(move || {
                let y0 = bi * band;
                for (ry, row) in chunk.chunks_exact_mut(w * 4).enumerate() {
                    let y = y0 + ry;
                    let yrow = &y_plane[y * pitch..y * pitch + w];
                    let uv_at = (y / 2) * pitch;
                    let uvrow = &uv_plane[uv_at..(uv_at + w).min(uv_plane.len())];
                    // Two pixels share one chroma pair: everything is looked at once per pair, with no index checks.
                    let pairs = row
                        .chunks_exact_mut(8)
                        .zip(yrow.chunks_exact(2))
                        .zip(uvrow.chunks_exact(2));
                    for ((out, ys2), uv) in pairs {
                        let u = uv[0] as i32 - 128;
                        let v = uv[1] as i32 - 128;
                        let (dr, dg, db) = (rv * v + 128, -(gu * u + gv * v) + 128, bu * u + 128);
                        for (k, &yv) in ys2.iter().enumerate() {
                            let c = (yv as i32 - yo) * ys;
                            out[k * 4] = ((c + db) >> 8).clamp(0, 255) as u8;
                            out[k * 4 + 1] = ((c + dg) >> 8).clamp(0, 255) as u8;
                            out[k * 4 + 2] = ((c + dr) >> 8).clamp(0, 255) as u8;
                            out[k * 4 + 3] = 255;
                        }
                    }
                    // An odd last column (the encoder never makes one, but a source could).
                    if w % 2 == 1 {
                        let x = w - 1;
                        let c = (yrow[x] as i32 - yo) * ys;
                        let u = *uvrow.get(x & !1).unwrap_or(&128) as i32 - 128;
                        let v = *uvrow.get((x & !1) + 1).unwrap_or(&128) as i32 - 128;
                        row[x * 4] = ((c + bu * u + 128) >> 8).clamp(0, 255) as u8;
                        row[x * 4 + 1] = ((c - gu * u - gv * v + 128) >> 8).clamp(0, 255) as u8;
                        row[x * 4 + 2] = ((c + rv * v + 128) >> 8).clamp(0, 255) as u8;
                        row[x * 4 + 3] = 255;
                    }
                }
            });
        }
    });
}

#[cfg(windows)]
pub mod win {
    use std::fs::File;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::core::PCWSTR;
    use windows::Win32::Media::MediaFoundation::{
        IMF2DBuffer, IMFAttributes, IMFMediaType, IMFSample, IMFSourceReader, MFCreateAttributes,
        MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Video, MFShutdown, MFStartup,
        MFVideoFormat_NV12, MFVideoFormat_RGB32, MFSTARTUP_FULL, MF_MT_DEFAULT_STRIDE,
        MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_MT_VIDEO_NOMINAL_RANGE,
        MF_MT_YUV_MATRIX, MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READER_FIRST_VIDEO_STREAM,
        MF_VERSION,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows_capture::encoder::{
        AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
        VideoSettingsSubType,
    };

    use windows::core::Interface;

    use super::{
        copy_rows, flip_into, infer_pitch, mix_next, nv12_layout, nv12_to_bgra, CursorLayer,
        TrackReader, OUT_RATE,
    };
    use crate::compose::{plan_output, scale_into};
    use crate::effects::ExportSettings;
    use crate::recording::RecordingInfo;

    struct Mf;
    impl Mf {
        fn start() -> Result<Self, String> {
            // SAFETY: balanced by `Drop`.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| e.to_string())?;
            }
            Ok(Self)
        }
    }
    impl Drop for Mf {
        fn drop(&mut self) {
            // SAFETY: balances `start`.
            unsafe {
                let _ = MFShutdown();
                CoUninitialize();
            }
        }
    }

    /// An opened video: the reader, the size, and how the pictures come out.
    struct Opened {
        reader: IMFSourceReader,
        w: u32,
        h: u32,
        /// NV12 (the decoder's own format, converted here) or RGB32 (converted by Media Foundation: several times slower).
        nv12: bool,
        /// RGB32 only: rows stored bottom first, and bytes per stored row.
        bottom_up: bool,
        stride: usize,
        bt709: bool,
        full_range: bool,
    }

    /// A Direct3D device for hardware video decoding (the GPU decodes; the pictures are read back as NV12). `None` when there is
    /// no such device: decoding then happens on the processor.
    unsafe fn gpu_manager() -> Option<windows::Win32::Media::MediaFoundation::IMFDXGIDeviceManager>
    {
        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, ID3D11Device, ID3D11Multithread, D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            D3D11_SDK_VERSION,
        };
        use windows::Win32::Media::MediaFoundation::MFCreateDXGIDeviceManager;
        unsafe {
            let mut device: Option<ID3D11Device> = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )
            .ok()?;
            let device = device?;
            if let Ok(mt) = device.cast::<ID3D11Multithread>() {
                let _ = mt.SetMultithreadProtected(true);
            }
            let (mut token, mut manager) = (0u32, None);
            MFCreateDXGIDeviceManager(&mut token, &mut manager).ok()?;
            let manager = manager?;
            manager.ResetDevice(&device, token).ok()?;
            Some(manager)
        }
    }

    fn open_reader(path: &Path) -> Result<Opened, String> {
        let wide: Vec<u16> = path.as_os_str().encode_wide_nul();
        // SAFETY: COM/MF calls with valid arguments; `wide` is NUL-terminated.
        unsafe {
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 3).map_err(|e| e.to_string())?;
            let attrs = attrs.ok_or("no attributes")?;
            if std::env::var("SNIPMUNK_SOFT_DECODE").is_err() {
                // The graphics card decodes the video when it can.
                if let Some(manager) = gpu_manager() {
                    let _ = attrs.SetUnknown(
                        &windows::Win32::Media::MediaFoundation::MF_SOURCE_READER_D3D_MANAGER,
                        &manager,
                    );
                    let _ = attrs.SetUINT32(
                        &windows::Win32::Media::MediaFoundation::MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS,
                        1,
                    );
                }
            }
            let reader = MFCreateSourceReaderFromURL(PCWSTR(wide.as_ptr()), &attrs)
                .map_err(|e| e.to_string())?;
            let wanted: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
            wanted
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| e.to_string())?;
            // NV12 is what the decoder produces: asking for it skips Media Foundation's colour conversion (the slow part).
            wanted
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                .map_err(|e| e.to_string())?;
            let nv12 = std::env::var("SNIPMUNK_RGB_DECODE").is_err()
                && reader
                    .SetCurrentMediaType(
                        MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                        None,
                        &wanted,
                    )
                    .is_ok();
            if !nv12 {
                wanted
                    .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
                    .map_err(|e| e.to_string())?;
                reader
                    .SetCurrentMediaType(
                        MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                        None,
                        &wanted,
                    )
                    .map_err(|e| e.to_string())?;
            }
            let current = reader
                .GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)
                .map_err(|e| e.to_string())?;
            let size = current
                .GetUINT64(&MF_MT_FRAME_SIZE)
                .map_err(|e| e.to_string())?;
            let (w, h) = ((size >> 32) as u32, size as u32);
            // RGB pictures are bottom-up when the stride is negative (the usual case for Windows bitmaps).
            let stride = current
                .GetUINT32(&MF_MT_DEFAULT_STRIDE)
                .map(|s| s as i32)
                .unwrap_or(-(w as i32 * 4));
            // Colour: what the stream says, else the usual choice (BT.709 from 720 lines up, limited range).
            let bt709 = match current.GetUINT32(&MF_MT_YUV_MATRIX) {
                Ok(m) => m == 1,
                Err(_) => h >= 720,
            };
            let full_range = current
                .GetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE)
                .is_ok_and(|r| r == 1);
            Ok(Opened {
                reader,
                w,
                h,
                nv12,
                bottom_up: stride < 0,
                stride: stride.unsigned_abs() as usize,
                bt709,
                full_range,
            })
        }
    }

    trait WideNul {
        fn encode_wide_nul(&self) -> Vec<u16>;
    }
    impl WideNul for std::ffi::OsStr {
        fn encode_wide_nul(&self) -> Vec<u16> {
            use std::os::windows::ffi::OsStrExt;
            self.encode_wide().chain(Some(0)).collect()
        }
    }

    /// What the decoding thread tells the rendering thread.
    enum Msg {
        /// The size of the pictures.
        Size(u32, u32),
        /// A picture (BGRA, top row first) and its time in 100 ns units.
        Frame(i64, Vec<u8>),
        End,
        Failed(String),
    }

    /// Read the pictures of `path` on this thread and send them on; stops at the end, on an error, or when `cancel` is set.
    fn decode(
        path: &Path,
        tx: &std::sync::mpsc::SyncSender<Msg>,
        cancel: &AtomicBool,
        seek_ticks: i64,
    ) {
        let run = || -> Result<(), String> {
            let _mf = Mf::start()?;
            let Opened {
                reader,
                w,
                h,
                nv12,
                bottom_up,
                stride,
                bt709,
                full_range,
            } = open_reader(path)?;
            if tx.send(Msg::Size(w, h)).is_err() {
                return Ok(());
            }
            if seek_ticks > 0 {
                // SAFETY: a valid position (100 ns units) for a reader that was just opened.
                unsafe {
                    let pos = windows::Win32::System::Com::StructuredStorage::PROPVARIANT::from(
                        seek_ticks,
                    );
                    let _ = reader.SetCurrentPosition(&windows::core::GUID::zeroed(), &pos);
                }
            }
            let row = w as usize * 4;
            let need = row * h as usize;
            while !cancel.load(Ordering::SeqCst) {
                let mut flags = 0u32;
                let mut ts = 0i64;
                let mut sample: Option<IMFSample> = None;
                let t_read = std::time::Instant::now();
                // SAFETY: valid out pointers; the sample is read inside this iteration.
                let read = unsafe {
                    reader.ReadSample(
                        MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                        0,
                        None,
                        Some(&mut flags),
                        Some(&mut ts),
                        Some(&mut sample),
                    )
                };
                if read.is_err() || flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                    break;
                }
                lap(7, &t_read);
                let Some(sample) = sample else { continue };
                let t_alloc = std::time::Instant::now();
                let mut top_down = vec![0u8; need];
                lap(8, &t_alloc);
                let t_conv = std::time::Instant::now();
                // SAFETY: the buffer is locked for the copy and unlocked right after; `len` bytes are valid while locked.
                let ok = unsafe {
                    // The buffer as the decoder made it keeps its 2-D layout; a copy into one flat buffer does not.
                    let original = if sample.GetBufferCount().unwrap_or(0) == 1 {
                        sample.GetBufferByIndex(0).ok()
                    } else {
                        None
                    };
                    let buffer = match original {
                        Some(b) if b.cast::<IMF2DBuffer>().is_ok() => b,
                        _ => sample
                            .ConvertToContiguousBuffer()
                            .map_err(|e| e.to_string())?,
                    };
                    if std::env::var("SNIPMUNK_PROFILE").is_ok()
                        && nv12
                        && !PROF_ONCE.swap(true, Ordering::Relaxed)
                    {
                        eprintln!(
                            "decoded picture is a GPU surface: {}",
                            buffer
                                .cast::<windows::Win32::Media::MediaFoundation::IMFDXGIBuffer>()
                                .is_ok()
                        );
                    }
                    // The rows of a decoded picture are usually padded (aligned to 16 or 64 pixels): the real pitch comes from
                    // the 2-D buffer, never from width * 4. A negative pitch means the rows are stored bottom first.
                    let mut ok = false;
                    if nv12 {
                        let mut data = std::ptr::null_mut();
                        let mut len = 0u32;
                        buffer
                            .Lock(&mut data, None, Some(&mut len))
                            .map_err(|e| e.to_string())?;
                        let src = std::slice::from_raw_parts(data, len as usize);
                        if let Some((pitch, ah)) = nv12_layout(src.len(), w as usize, h as usize) {
                            nv12_to_bgra(
                                src,
                                pitch,
                                ah,
                                w as usize,
                                h as usize,
                                bt709,
                                full_range,
                                &mut top_down,
                            );
                            ok = true;
                        }
                        let _ = buffer.Unlock();
                        lap(9, &t_conv);
                    } else if let Ok(b2) = buffer.cast::<IMF2DBuffer>() {
                        let mut first = std::ptr::null_mut();
                        let mut pitch = 0i32;
                        if b2.Lock2D(&mut first, &mut pitch).is_ok() {
                            if !first.is_null() && pitch != 0 {
                                let step = pitch as isize;
                                for (y, dst) in top_down.chunks_exact_mut(row).enumerate() {
                                    let p = first.offset(step * y as isize);
                                    dst.copy_from_slice(std::slice::from_raw_parts(p, row));
                                }
                                ok = true;
                            }
                            let _ = b2.Unlock2D();
                        }
                    }
                    if !ok && !nv12 {
                        let mut data = std::ptr::null_mut();
                        let mut len = 0u32;
                        buffer
                            .Lock(&mut data, None, Some(&mut len))
                            .map_err(|e| e.to_string())?;
                        let src = std::slice::from_raw_parts(data, len as usize);
                        // A flat buffer has no pitch of its own: the decoder pads rows (to 64 bytes) and the height (to 16),
                        // so the pitch is worked out from the size of the buffer.
                        let pitch = infer_pitch(len as usize, stride.max(row), h as usize);
                        ok = copy_rows(src, pitch, h as usize, row, bottom_up, &mut top_down);
                        let _ = buffer.Unlock();
                    }
                    ok
                };
                if ok && tx.send(Msg::Frame(ts, top_down)).is_err() {
                    return Ok(());
                }
            }
            Ok(())
        };
        match run() {
            Ok(()) => {
                let _ = tx.send(Msg::End);
            }
            Err(e) => {
                let _ = tx.send(Msg::Failed(e));
            }
        }
    }

    /// The first `max` pictures of a video (BGRA, top row first) and its size: used by the tests to look at what was written.
    #[cfg(test)]
    pub fn read_frames(path: &Path, max: usize) -> Result<(u32, u32, Vec<Vec<u8>>), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Msg>(4);
        let stop = AtomicBool::new(false);
        std::thread::scope(|scope| {
            let d = scope.spawn(|| decode(path, &tx, &stop, 0));
            let (mut w, mut h) = (0, 0);
            let mut out = Vec::new();
            while let Ok(m) = rx.recv() {
                match m {
                    Msg::Size(a, b) => (w, h) = (a, b),
                    Msg::Frame(_, p) => {
                        out.push(p);
                        if out.len() >= max {
                            break;
                        }
                    }
                    Msg::End => break,
                    Msg::Failed(e) => {
                        stop.store(true, Ordering::SeqCst);
                        while rx.try_recv().is_ok() {}
                        drop(rx);
                        let _ = d.join();
                        return Err(e);
                    }
                }
            }
            stop.store(true, Ordering::SeqCst);
            while rx.try_recv().is_ok() {}
            drop(rx);
            let _ = d.join();
            Ok((w, h, out))
        })
    }

    /// The webcam video, read on its own thread: the picture that belongs to a time of the recording.
    struct WebcamFeed {
        rx: std::sync::mpsc::Receiver<Msg>,
        w: u32,
        h: u32,
        /// The newest picture that is not later than the time asked for, and the next one (already read).
        current: Option<Vec<u8>>,
        next: Option<(i64, Vec<u8>)>,
        ended: bool,
    }

    impl WebcamFeed {
        fn size(&self) -> (u32, u32) {
            (self.w, self.h)
        }

        /// The picture for `ticks` (100 ns) of the webcam's own time.
        fn at(&mut self, ticks: i64) -> Option<&Vec<u8>> {
            loop {
                if let Some((ts, _)) = &self.next {
                    if *ts <= ticks {
                        self.current = self.next.take().map(|(_, p)| p);
                        continue;
                    }
                    break;
                }
                if self.ended {
                    break;
                }
                match self.rx.recv() {
                    Ok(Msg::Frame(ts, p)) => self.next = Some((ts, p)),
                    Ok(Msg::Size(..)) => {}
                    _ => self.ended = true,
                }
            }
            self.current.as_ref()
        }
    }

    /// What an export writes to.
    enum Output<'s> {
        /// The pictures go to a thread that flips them, hands them to the encoder and feeds the sound: drawing the next picture
        /// goes on meanwhile. The thread finishes the file (and renames it) when the channel is closed.
        Mp4 {
            tx: Option<std::sync::mpsc::SyncSender<(Vec<u8>, i64)>>,
            job: Option<std::thread::ScopedJoinHandle<'s, Result<(), String>>>,
        },
        Gif(crate::gifexport::GifWriter<std::io::BufWriter<File>>),
        /// A GIF kept in memory for the first `limit` pictures: the size estimate.
        Probe(crate::gifexport::GifWriter<Vec<u8>>, u32),
    }

    /// What to export and where to.
    pub struct Request<'a> {
        pub dir: &'a Path,
        /// The file to make (written as `<file>.part` first, then renamed). Not used for a probe.
        pub out: PathBuf,
        pub settings: ExportSettings,
        pub system_volume: f32,
        pub mic_volume: f32,
        /// Only measure: encode the first pictures of a GIF in memory and report the size.
        pub probe: Option<u32>,
    }

    /// What an export or a probe found.
    #[derive(Debug, Clone, Default)]
    pub struct Exported {
        pub file: PathBuf,
        pub frames: u64,
        pub seconds: f64,
        pub width: u32,
        pub height: u32,
        pub fps: u32,
        /// The length of what was exported (the trimmed part), in milliseconds.
        pub duration_ms: u64,
        /// Probe: bytes of the pictures that were encoded, and of the first one.
        pub probe_bytes: u64,
        pub probe_first_bytes: u64,
        pub probe_frames: u32,
    }

    /// Where the time of an export goes (nanoseconds per stage), printed when `SNIPMUNK_PROFILE` is set:
    /// 0 waiting for a picture, 1 effects, 2 scaling, 3 webcam, 4 flip, 5 encoder, 6 sound.
    pub static PROF: [std::sync::atomic::AtomicU64; 10] =
        [const { std::sync::atomic::AtomicU64::new(0) }; 10];

    static PROF_ONCE: AtomicBool = AtomicBool::new(false);

    fn lap(stage: usize, since: &std::time::Instant) {
        PROF[stage].fetch_add(since.elapsed().as_nanos() as u64, Ordering::Relaxed);
    }

    fn read_info(dir: &Path) -> RecordingInfo {
        std::fs::read(dir.join("recording.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    /// Make the exported file of a recording (see the module text), or measure a GIF (`probe`). Reports 0..1 to `progress`; stops
    /// and removes the partial file when `cancel` is set. Decoding, drawing and encoding run on separate threads.
    #[allow(clippy::chunks_exact_to_as_chunks)]
    pub fn render(
        req: &Request,
        progress: &dyn Fn(f32),
        cancel: &AtomicBool,
    ) -> Result<Exported, String> {
        let dir = req.dir;
        let started = std::time::Instant::now();
        let info = read_info(dir);
        let fx = info.effects.clone().unwrap_or_default().cleaned();
        let settings = &req.settings;
        let gif = settings.is_gif();
        let fps = if info.fps == 0 { 30 } else { info.fps };
        let total_ms = info.duration_ms.max(1);
        let start_ms = fx.trim.start_ms.min(total_ms.saturating_sub(1));
        let end_ms = fx
            .trim
            .end_ms
            .map_or(total_ms, |e| e.min(total_ms))
            .max(start_ms + 1);
        let span_ms = end_ms - start_ms;
        let start_ticks = start_ms as i64 * 10_000;

        // The sound (MP4 only): both tracks, the part before the trim start skipped.
        let mut tracks = Vec::new();
        if !gif {
            for (name, vol) in [
                ("system.wav", req.system_volume),
                ("mic.wav", req.mic_volume),
            ] {
                if dir.join(name).is_file() {
                    if let Ok(t) = TrackReader::open(&dir.join(name), vol) {
                        tracks.push(t);
                    }
                }
            }
            let mut skip = start_ms * OUT_RATE as u64 / 1000;
            while skip > 0 && !tracks.is_empty() {
                let n = skip.min(48_000) as usize;
                let _ = mix_next(&mut tracks, n);
                skip -= n as u64;
            }
        }
        let cursor = info
            .cursor_file
            .as_deref()
            .and_then(|f| CursorLayer::load(dir, f));

        let (tx, rx) = std::sync::mpsc::sync_channel::<Msg>(6);
        let screen = dir.join("screen.mp4");
        let stop = AtomicBool::new(false);
        // The webcam: read on its own thread, only when it was recorded and is to be shown.
        let webcam_path = info
            .webcam_file
            .as_deref()
            .map(|f| dir.join(f))
            .filter(|p| p.is_file() && fx.webcam.show);
        let (wtx, wrx) = std::sync::mpsc::sync_channel::<Msg>(4);

        let result = std::thread::scope(|scope| -> Result<Exported, String> {
            // A trimmed export starts a second before the trim start (Media Foundation goes to a keyframe and may start late; the
            // pictures before the start are dropped here), not at the beginning of the video.
            let (stop_ref, screen_ref, tx_ref) = (&stop, &screen, &tx);
            let decoder = scope.spawn(move || {
                decode(
                    screen_ref,
                    tx_ref,
                    stop_ref,
                    (start_ticks - 10_000_000).max(0),
                )
            });
            let cam_decoder = webcam_path.as_ref().map(|p| {
                let cam_seek =
                    (start_ticks - info.webcam_start_ms as i64 * 10_000 - 10_000_000).max(0);
                scope.spawn(move || decode(p, &wtx, stop_ref, cam_seek))
            });
            let outcome = (|| -> Result<Exported, String> {
                let (w, h) = match rx.recv().map_err(|e| e.to_string())? {
                    Msg::Size(w, h) => (w, h),
                    Msg::Failed(e) => return Err(e),
                    _ => return Err("the video could not be read".into()),
                };
                let plan = plan_output(w, h, settings.aspect, settings.fit, settings.short_side());
                let mut webcam = if webcam_path.is_some() {
                    match wrx.recv() {
                        Ok(Msg::Size(cw, ch)) => Some(WebcamFeed {
                            rx: wrx,
                            w: cw,
                            h: ch,
                            current: None,
                            next: None,
                            ended: false,
                        }),
                        _ => None,
                    }
                } else {
                    None
                };
                let part = req.out.with_file_name(format!(
                    "{}.part",
                    req.out
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("export")
                ));
                let out_fps = if gif { settings.gif_fps() } else { fps };
                let mut output = if let Some(limit) = req.probe {
                    Output::Probe(
                        crate::gifexport::GifWriter::new(Vec::new(), plan.w, plan.h, out_fps)
                            .map_err(|e| e.to_string())?,
                        limit,
                    )
                } else if gif {
                    let file = File::create(&part).map_err(|e| e.to_string())?;
                    Output::Gif(
                        crate::gifexport::GifWriter::new(
                            std::io::BufWriter::new(file),
                            plan.w,
                            plan.h,
                            out_fps,
                        )
                        .map_err(|e| e.to_string())?,
                    )
                } else {
                    let mut enc = VideoEncoder::new(
                        VideoSettingsBuilder::new(plan.w, plan.h)
                            .sub_type(VideoSettingsSubType::H264)
                            .frame_rate(fps)
                            .bitrate(settings.bitrate(plan.w, plan.h, fps)),
                        AudioSettingsBuilder::default()
                            .disabled(tracks.is_empty())
                            .sample_rate(OUT_RATE)
                            .channel_count(2)
                            .bit_per_sample(16),
                        ContainerSettingsBuilder::default(),
                        &part,
                    )
                    .map_err(|e| e.to_string())?;
                    let (tx, picture_rx) = std::sync::mpsc::sync_channel::<(Vec<u8>, i64)>(3);
                    let mut sound = std::mem::take(&mut tracks);
                    let (part2, out2) = (part.clone(), req.out.clone());
                    let (pw, ph) = (plan.w as usize, plan.h as usize);
                    let job = scope.spawn(move || -> Result<(), String> {
                        let mut flipped: Vec<u8> = Vec::new();
                        let mut audio_fed: u64 = 0;
                        while let Ok((canvas, rel)) = picture_rx.recv() {
                            if cancel.load(Ordering::SeqCst) {
                                drop(enc);
                                let _ = std::fs::remove_file(&part2);
                                return Err("cancelled".into());
                            }
                            // The encoder reads the rows bottom first; one buffer is reused.
                            let t = std::time::Instant::now();
                            flip_into(&canvas, pw, ph, &mut flipped);
                            drop(canvas);
                            lap(4, &t);
                            let t = std::time::Instant::now();
                            enc.send_frame_buffer(&flipped, rel)
                                .map_err(|e| e.to_string())?;
                            lap(5, &t);
                            let t = std::time::Instant::now();
                            // The sound up to this picture.
                            if !sound.is_empty() {
                                let wanted =
                                    (rel.max(0) as u128 * OUT_RATE as u128 / 10_000_000) as u64;
                                while audio_fed < wanted {
                                    let n = ((wanted - audio_fed) as usize).min(4800);
                                    let bytes = mix_next(&mut sound, n);
                                    enc.send_audio_buffer(&bytes, 0)
                                        .map_err(|e| e.to_string())?;
                                    audio_fed += n as u64;
                                }
                            }
                            lap(6, &t);
                        }
                        enc.finish().map_err(|e| e.to_string())?;
                        std::fs::rename(&part2, &out2).map_err(|e| e.to_string())
                    });
                    Output::Mp4 {
                        tx: Some(tx),
                        job: Some(job),
                    }
                };
                let abort = |output: Output| {
                    if let Output::Mp4 { tx, job } = output {
                        drop(tx);
                        if let Some(j) = job {
                            let _ = j.join();
                        }
                    }
                    let _ = std::fs::remove_file(&part);
                };
                let mut frames = 0u64;
                let mut next_emit_ms = start_ms as f64;
                let mut probe_first = 0u64;
                let gif_step = 1000.0 / out_fps as f64;
                let identity = plan.w == w
                    && plan.h == h
                    && plan.src == (0, 0, w, h)
                    && plan.dst == (0, 0, w, h);
                loop {
                    if cancel.load(Ordering::SeqCst) {
                        abort(output);
                        return Err("cancelled".into());
                    }
                    let t_recv = std::time::Instant::now();
                    let (ts, mut picture) = match rx.recv().map_err(|e| e.to_string())? {
                        Msg::Frame(ts, p) => (ts, p),
                        Msg::End => break,
                        Msg::Failed(e) => {
                            abort(output);
                            return Err(e);
                        }
                        Msg::Size(..) => continue,
                    };
                    let ms = (ts / 10_000).max(0) as u64;
                    if ms < start_ms {
                        continue;
                    }
                    if ms > end_ms {
                        break;
                    }
                    // A GIF has fewer pictures than the video.
                    if gif {
                        if (ms as f64) < next_emit_ms {
                            continue;
                        }
                        next_emit_ms += gif_step;
                        if next_emit_ms < ms as f64 {
                            next_emit_ms = ms as f64 + gif_step;
                        }
                    }
                    lap(0, &t_recv);
                    let t = std::time::Instant::now();
                    if let Some(c) = &cursor {
                        c.draw_fx(&mut picture, w, h, ms, &fx);
                    }
                    lap(1, &t);
                    let t = std::time::Instant::now();
                    // To the size, aspect ratio and resolution that were chosen.
                    let mut canvas = if identity {
                        picture
                    } else {
                        let mut c = vec![0u8; plan.w as usize * plan.h as usize * 4];
                        for p in c.chunks_exact_mut(4) {
                            p[3] = 255;
                        }
                        scale_into(
                            &picture,
                            w as usize,
                            plan.src,
                            &mut c,
                            plan.w as usize,
                            plan.dst,
                        );
                        c
                    };
                    lap(2, &t);
                    let t = std::time::Instant::now();
                    // The webcam goes on the final picture, so it keeps its size and place whatever the aspect ratio is.
                    if let Some(cam) = webcam.as_mut() {
                        let rel = (ms as i64 - info.webcam_start_ms as i64) * 10_000;
                        if rel >= 0 {
                            let (cw, ch) = cam.size();
                            if let Some(pic) = cam.at(rel) {
                                crate::compose::draw_webcam(
                                    &mut canvas,
                                    plan.w as usize,
                                    plan.h as usize,
                                    pic,
                                    cw as usize,
                                    ch as usize,
                                    fx.webcam_rect(plan.w, plan.h),
                                    fx.webcam_shape(),
                                    fx.webcam.border,
                                );
                            }
                        }
                    }
                    lap(3, &t);
                    match &mut output {
                        Output::Mp4 { tx, job } => {
                            let sent = tx
                                .as_ref()
                                .is_some_and(|t| t.send((canvas, ts - start_ticks)).is_ok());
                            if !sent {
                                // The thread that writes the file stopped: its error says why.
                                drop(tx.take());
                                let why = job
                                    .take()
                                    .and_then(|j| j.join().ok())
                                    .and_then(|r| r.err())
                                    .unwrap_or_else(|| "the video could not be written".into());
                                let _ = std::fs::remove_file(&part);
                                return Err(why);
                            }
                        }
                        Output::Gif(g) => g.push(&canvas).map_err(|e| e.to_string())?,
                        Output::Probe(g, limit) => {
                            g.push(&canvas).map_err(|e| e.to_string())?;
                            if frames == 0 {
                                probe_first = g.frames as u64;
                            }
                            if g.frames >= *limit {
                                frames += 1;
                                break;
                            }
                        }
                    }
                    frames += 1;
                    if frames.is_multiple_of(10) {
                        progress(((ms - start_ms) as f32 / span_ms as f32).clamp(0.0, 1.0));
                    }
                }
                let mut exported = Exported {
                    file: req.out.clone(),
                    frames,
                    seconds: 0.0,
                    width: plan.w,
                    height: plan.h,
                    fps: out_fps,
                    duration_ms: span_ms,
                    ..Exported::default()
                };
                match output {
                    Output::Mp4 { tx, job } => {
                        // No more pictures: the thread writes what is left, finishes the file and renames it.
                        drop(tx);
                        if let Some(j) = job {
                            j.join()
                                .map_err(|_| "the video could not be written".to_string())??;
                        }
                    }
                    Output::Gif(g) => {
                        let mut file = g.finish().map_err(|e| e.to_string())?;
                        std::io::Write::flush(&mut file).map_err(|e| e.to_string())?;
                        drop(file);
                        std::fs::rename(&part, &req.out).map_err(|e| e.to_string())?;
                    }
                    Output::Probe(g, _) => {
                        let n = g.frames;
                        let bytes = g.finish().map_err(|e| e.to_string())?;
                        exported.probe_bytes = bytes.len() as u64;
                        exported.probe_frames = n;
                        exported.probe_first_bytes = probe_first;
                    }
                }
                progress(1.0);
                exported.seconds = started.elapsed().as_secs_f64();
                if std::env::var("SNIPMUNK_PROFILE").is_ok() {
                    let s = |i: usize| PROF[i].swap(0, Ordering::Relaxed) as f64 / 1e9;
                    eprintln!(
                        "PROFILE total {:.1}s | wait-for-picture {:.1} (decoder: read {:.1} alloc {:.1} convert {:.1}) effects {:.1} scale {:.1} webcam {:.1} | flip {:.1} encoder {:.1} sound {:.1}",
                        exported.seconds, s(0), s(7), s(8), s(9), s(1), s(2), s(3), s(4), s(5), s(6)
                    );
                }
                Ok(exported)
            })();
            // Whatever happened: the decoders are told to stop and their channels are emptied, so they cannot wait on a full one.
            stop.store(true, Ordering::SeqCst);
            while rx.try_recv().is_ok() {}
            drop(rx);
            let _ = decoder.join();
            if let Some(c) = cam_decoder {
                let _ = c.join();
            }
            outcome
        });
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{TrackWriter, TICKS};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn wav(dir: &Path, name: &str, rate: u32, channels: u16, secs: u32, hz: f64) -> PathBuf {
        let path = dir.join(name);
        let on = Arc::new(AtomicBool::new(true));
        let mut w = TrackWriter::create(&path, rate, channels, 0, on).unwrap();
        let frames = rate * secs;
        let mut s = Vec::new();
        for i in 0..frames {
            let v = ((i as f64 / rate as f64 * hz * std::f64::consts::TAU).sin() * 0.5) as f32;
            for _ in 0..channels {
                s.push(v);
            }
        }
        for (k, chunk) in s
            .chunks(rate as usize * channels as usize / 100)
            .enumerate()
        {
            w.push(chunk, (k as i64) * TICKS / 100);
        }
        w.finish(secs as i64 * TICKS).unwrap();
        path
    }

    #[test]
    fn rows_with_padding_are_copied_top_down_and_odd_pictures_are_cropped() {
        // 3 pixels wide (12 bytes) with 4 bytes of padding per row, 2 rows.
        let src: Vec<u8> = (0..32).collect();
        let mut out = vec![0u8; 24];
        assert!(copy_rows(&src, 16, 2, 12, false, &mut out));
        assert_eq!(&out[..12], &src[..12]);
        assert_eq!(&out[12..], &src[16..28]);
        assert!(copy_rows(&src, 16, 2, 12, true, &mut out));
        assert_eq!(&out[..12], &src[16..28]);
        assert!(
            !copy_rows(&src[..20], 16, 2, 12, false, &mut out),
            "too short"
        );
        // The case found with a 676x1182 recording: rows of 2752 bytes, 1184 rows.
        assert_eq!(infer_pitch(3_258_368, 2704, 1182), 2752);
        assert_eq!(infer_pitch(2704 * 1182, 2704, 1182), 2704);
        assert_eq!(infer_pitch(100, 40, 3), 40, "nothing fits: the stride");
    }

    #[test]
    fn the_cursor_is_drawn_with_its_hot_spot_at_the_position_and_cut_off_at_the_edges() {
        let mut frame = vec![0u8; 8 * 8 * 4];
        let mut img = image::RgbaImage::new(3, 3);
        for p in img.pixels_mut() {
            *p = image::Rgba([255, 0, 0, 255]);
        }
        blend_cursor(&mut frame, 8, 8, &img, 2, 2);
        fn px(frame: &[u8], x: usize, y: usize) -> &[u8] {
            &frame[(y * 8 + x) * 4..(y * 8 + x) * 4 + 4]
        }
        assert_eq!(px(&frame, 2, 2), &[0, 0, 255, 255], "BGRA: red");
        assert_eq!(px(&frame, 4, 4), &[0, 0, 255, 255]);
        assert_eq!(px(&frame, 5, 5), &[0, 0, 0, 0]);
        // Half outside: no panic, the visible part is drawn.
        blend_cursor(&mut frame, 8, 8, &img, 6, 6);
        assert_eq!(px(&frame, 7, 7), &[0, 0, 255, 255]);
        blend_cursor(&mut frame, 8, 8, &img, -2, -2);
        assert_eq!(px(&frame, 0, 0), &[0, 0, 255, 255]);
    }

    #[test]
    fn a_half_transparent_pixel_is_mixed_with_the_picture() {
        let mut frame = vec![100u8; 4];
        let mut img = image::RgbaImage::new(1, 1);
        img.put_pixel(0, 0, image::Rgba([200, 200, 200, 128]));
        blend_cursor(&mut frame, 1, 1, &img, 0, 0);
        assert!((frame[0] as i32 - 150).abs() <= 1, "{frame:?}");
        assert_eq!(frame[3], 255);
    }

    #[test]
    fn tracks_of_other_rates_and_channels_are_mixed_as_48k_stereo() {
        let dir = tempfile::tempdir().unwrap();
        let a = wav(dir.path(), "system.wav", 44_100, 2, 2, 440.0);
        let b = wav(dir.path(), "mic.wav", 16_000, 1, 2, 880.0);
        let mut tracks = vec![
            TrackReader::open(&a, 1.0).unwrap(),
            TrackReader::open(&b, 0.5).unwrap(),
        ];
        let mut total = 0usize;
        let mut peak = 0i16;
        for _ in 0..30 {
            let bytes = mix_next(&mut tracks, 4800);
            total += bytes.len() / 4;
            for s in bytes.as_chunks::<2>().0 {
                peak = peak.max(i16::from_le_bytes([s[0], s[1]]).abs());
            }
        }
        assert_eq!(
            total, 144_000,
            "3 seconds at 48 kHz: 2 s of sound then silence"
        );
        assert!(peak > 10_000 && peak < 32_767, "{peak}");
        // Past the end of both tracks there is silence.
        assert!(mix_next(&mut tracks, 480).iter().all(|b| *b == 0));
        assert!(tracks.iter().all(|t| t.done()));
    }

    #[test]
    fn a_volume_of_zero_silences_a_track() {
        let dir = tempfile::tempdir().unwrap();
        let a = wav(dir.path(), "system.wav", 48_000, 2, 1, 440.0);
        let mut t = vec![TrackReader::open(&a, 0.0).unwrap()];
        assert!(mix_next(&mut t, 4800).iter().all(|b| *b == 0));
    }

    #[test]
    fn the_file_is_made_again_only_when_something_it_is_made_from_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("screen.mp4"), b"v1").unwrap();
        let n = "Recording 2026-11-20 13-47.mp4";
        let key = cache_key(dir.path(), n, "", 1.0, 1.0);
        assert!(!is_fresh(dir.path(), n, &key), "nothing rendered yet");
        std::fs::write(dir.path().join(n), b"r").unwrap();
        std::fs::write(key_path(dir.path(), n), &key).unwrap();
        assert!(is_fresh(dir.path(), n, &key));
        assert_ne!(
            key,
            cache_key(dir.path(), n, "", 0.5, 1.0),
            "a volume changed"
        );
        std::fs::write(dir.path().join("system.wav"), b"audio").unwrap();
        assert_ne!(
            key,
            cache_key(dir.path(), n, "", 1.0, 1.0),
            "a track appeared"
        );
        assert!(!is_fresh(
            dir.path(),
            n,
            &cache_key(dir.path(), n, "", 1.0, 1.0)
        ));
    }

    #[test]
    fn the_mp4_estimate_uses_the_recordings_size_the_chosen_bitrate_and_the_trim() {
        let info = serde_json::json!({"width":3440,"height":1440,"fps":30,"durationMs":61000,"systemFile":"system.wav",
            "effects":{"trim":{"startMs":1000,"endMs":31000}}});
        let high = crate::effects::ExportSettings {
            quality: "high".into(),
            ..Default::default()
        };
        let (w, h, ms, bytes) = mp4_estimate(&info, &high);
        assert_eq!(
            (w, h, ms),
            (3440, 1440, 30000),
            "Original is the whole size"
        );
        let expected =
            (crate::recording::bitrate_for(3440, 1440, 30, "high") as u64 + 128_000) * 30 / 8;
        assert_eq!(bytes, expected);
        let p1080 = crate::effects::ExportSettings {
            resolution: "1080".into(),
            ..high.clone()
        };
        let (w2, h2, _, b2) = mp4_estimate(&info, &p1080);
        assert_eq!((w2, h2), (2580, 1080));
        assert!(b2 < bytes);
    }

    #[test]
    fn every_recording_has_its_own_render_and_a_copied_folder_never_reuses_another_ones() {
        // Same inputs in two folders: the keys differ, and a render file of A is not fresh for B.
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        for d in [&a, &b] {
            std::fs::write(d.path().join("screen.mp4"), b"same").unwrap();
        }
        let n = "Recording A.mp4";
        let ka = cache_key(a.path(), n, "", 1.0, 1.0);
        let kb = cache_key(b.path(), n, "", 1.0, 1.0);
        assert_ne!(ka, kb);
        std::fs::write(a.path().join(n), b"a").unwrap();
        std::fs::write(key_path(a.path(), n), &ka).unwrap();
        // The folder of A copied to B (file and key included) is not fresh in B.
        std::fs::write(b.path().join(n), b"a").unwrap();
        std::fs::write(key_path(b.path(), n), &ka).unwrap();
        assert!(is_fresh(a.path(), n, &ka));
        assert!(!is_fresh(b.path(), n, &kb));
        // Another name in the same folder is another file.
        assert_ne!(ka, cache_key(a.path(), "Recording B.mp4", "", 1.0, 1.0));
        // A changed export setting or effect is another file.
        assert_ne!(ka, cache_key(a.path(), n, "gif|low", 1.0, 1.0));
    }

    #[test]
    fn the_key_follows_the_effects_and_the_export_settings() {
        let dir = tempfile::tempdir().unwrap();
        let settings = crate::effects::ExportSettings::default();
        std::fs::write(
            dir.path().join("recording.json"),
            r#"{"effects":{"cursor":{"halo":false}}}"#,
        )
        .unwrap();
        let k1 = export_key(dir.path(), &settings);
        std::fs::write(
            dir.path().join("recording.json"),
            r#"{"effects":{"cursor":{"halo":true}}}"#,
        )
        .unwrap();
        let k2 = export_key(dir.path(), &settings);
        assert_ne!(k1, k2, "a changed effect");
        let gif = crate::effects::ExportSettings {
            format: "gif".into(),
            ..settings.clone()
        };
        assert_ne!(k2, export_key(dir.path(), &gif), "another format");
        std::fs::write(dir.path().join("recording.json"), r#"{"durationMs":5}"#).unwrap();
        assert_eq!(
            export_key(dir.path(), &settings),
            export_key(dir.path(), &settings)
        );
    }
}

/// The rendering that runs, and whether it is to stop. One at a time.
#[derive(Default)]
pub struct RenderJob {
    running: std::sync::atomic::AtomicBool,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// What the page is told about a finished export.
fn finished(
    capture_id: &str,
    file: &Path,
    dir: &Path,
    made: bool,
    seconds: f64,
) -> serde_json::Value {
    let thumb = dir.join("first.png");
    crate::export::allow_file(file);
    crate::export::allow_file(&thumb);
    serde_json::json!({
        "captureId": capture_id,
        "file": file.to_string_lossy(),
        "thumb": thumb.to_string_lossy(),
        "made": made,
        "seconds": seconds,
    })
}

fn render_error(e: String) -> crate::error::CmdError {
    if e == "cancelled" {
        crate::error::CmdError::new("cancelled", "the rendering was cancelled")
    } else {
        crate::error::CmdError::new("capture", e)
    }
}

/// Run `work` on a blocking thread as the one rendering job (a second one is refused), reporting progress to the page.
#[cfg(windows)]
async fn run_job<T: Send + 'static>(
    app: &tauri::AppHandle,
    job: &RenderJob,
    capture_id: &str,
    work: impl FnOnce(&dyn Fn(f32), &std::sync::atomic::AtomicBool) -> Result<T, String>
        + Send
        + 'static,
) -> crate::error::CmdResult<T> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if job.running.swap(true, Ordering::SeqCst) {
        return Err(crate::error::CmdError::new(
            "busy",
            "a video is being rendered already",
        ));
    }
    job.cancel.store(false, Ordering::SeqCst);
    let cancel = job.cancel.clone();
    let (app2, id2) = (app.clone(), capture_id.to_string());
    let done = tauri::async_runtime::spawn_blocking(move || {
        let progress = |p: f32| {
            let _ = app2.emit(
                "render-progress",
                serde_json::json!({ "captureId": id2, "progress": p }),
            );
        };
        work(&progress, &cancel)
    })
    .await;
    job.running.store(false, Ordering::SeqCst);
    done.map_err(|e| crate::error::CmdError::new("capture", e.to_string()))?
        .map_err(render_error)
}

/// What a recording needs to be exported: its folder, the name of its file and the quality it was recorded at.
fn recording_for(
    state: &crate::commands::AppState,
    capture_id: &str,
) -> crate::error::CmdResult<(PathBuf, String, String)> {
    let store = state.sessions.lock().unwrap();
    let dir = store
        .recording_dir(capture_id)
        .ok_or_else(|| crate::error::CmdError::new("not_found", "this recording does not exist"))?;
    let info: serde_json::Value = std::fs::read(dir.join("recording.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let quality = info["quality"].as_str().unwrap_or("standard").to_string();
    // The name of the recording, without its extension.
    let name = store.recording_file_name(capture_id);
    Ok((dir, name, quality))
}

/// The default export of a recording, for Copy, drag out and Share: the original size as MP4, the cursor and the effects drawn,
/// the trim applied; `<recording name>.mp4` in the recording's folder. Made the first time it is needed and used again until
/// something it is made from changes. Tells the page how far it is (`render-progress`: capture id, 0..1). The files are then allowed
/// for Copy, drag and Share.
#[tauri::command]
pub async fn render_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::commands::AppState>,
    job: tauri::State<'_, RenderJob>,
    capture_id: String,
) -> crate::error::CmdResult<serde_json::Value> {
    let (dir, out_name, quality) = recording_for(&state, &capture_id)?;
    #[cfg(windows)]
    {
        let settings = crate::effects::ExportSettings::standard(&quality);
        let key = cache_key(&dir, &out_name, &export_key(&dir, &settings), 1.0, 1.0);
        let out = dir.join(&out_name);
        if is_fresh(&dir, &out_name, &key) {
            return Ok(finished(&capture_id, &out, &dir, false, 0.0));
        }
        let (dir2, out2, key2) = (dir.clone(), out.clone(), key.clone());
        let exported = run_job(&app, &job, &capture_id, move |progress, cancel| {
            let req = win::Request {
                dir: &dir2,
                out: out2.clone(),
                settings,
                system_volume: 1.0,
                mic_volume: 1.0,
                probe: None,
            };
            let r = win::render(&req, progress, cancel)?;
            std::fs::write(
                key_path(
                    &dir2,
                    out2.file_name().and_then(|n| n.to_str()).unwrap_or(""),
                ),
                &key2,
            )
            .map_err(|e| e.to_string())?;
            Ok(r)
        })
        .await?;
        Ok(finished(&capture_id, &out, &dir, true, exported.seconds))
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, &job, &dir, &out_name, &quality);
        Err(crate::error::CmdError::new(
            "unsupported",
            "Rendering needs Windows in this version.",
        ))
    }
}

/// Export a recording with the settings of the export dialog into `folder` as `file_name` (+ the extension of the format; a name
/// that is taken gets " (2)"). Returns the path. Progress and cancelling as for `render_recording`.
#[tauri::command]
pub async fn export_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::commands::AppState>,
    job: tauri::State<'_, RenderJob>,
    capture_id: String,
    settings: crate::effects::ExportSettings,
    folder: String,
    file_name: String,
) -> crate::error::CmdResult<serde_json::Value> {
    let (dir, default_name, _) = recording_for(&state, &capture_id)?;
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Err(crate::error::CmdError::new(
            "not_found",
            "the folder does not exist",
        ));
    }
    let stem = {
        let safe = crate::recstore::safe_name(
            file_name
                .trim()
                .trim_end_matches(&format!(".{}", settings.extension())),
        );
        if safe.is_empty() {
            default_name.trim_end_matches(".mp4").to_string()
        } else {
            safe
        }
    };
    let out = unique_file(&folder, &stem, settings.extension());
    #[cfg(windows)]
    {
        let (dir2, out2) = (dir.clone(), out.clone());
        let exported = run_job(&app, &job, &capture_id, move |progress, cancel| {
            let req = win::Request {
                dir: &dir2,
                out: out2,
                settings,
                system_volume: 1.0,
                mic_volume: 1.0,
                probe: None,
            };
            win::render(&req, progress, cancel)
        })
        .await?;
        Ok(serde_json::json!({
            "captureId": capture_id,
            "file": exported.file.to_string_lossy(),
            "seconds": exported.seconds,
            "width": exported.width,
            "height": exported.height,
            "frames": exported.frames,
            "bytes": std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0),
        }))
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, &job, &dir, &out, &settings);
        Err(crate::error::CmdError::new(
            "unsupported",
            "Exporting needs Windows in this version.",
        ))
    }
}

/// `<folder>\<stem>.<ext>`, or `<stem> (2).<ext>` ... when the name is taken.
pub fn unique_file(folder: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = folder.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| folder.join(format!("{stem} ({n}).{ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// What an MP4 export will be, worked out from the recording's own numbers without reading the video: the size of the picture
/// (the same plan the export uses), the length of the kept part and the size of the file (video bitrate + 128 kbit/s of sound).
pub fn mp4_estimate(
    info: &serde_json::Value,
    settings: &crate::effects::ExportSettings,
) -> (u32, u32, u64, u64) {
    let sw = info["width"].as_u64().unwrap_or(1920).max(2) as u32;
    let sh = info["height"].as_u64().unwrap_or(1080).max(2) as u32;
    let fps = info["fps"].as_u64().unwrap_or(30).max(1) as u32;
    let total = info["durationMs"].as_u64().unwrap_or(0);
    let start = info["effects"]["trim"]["startMs"]
        .as_u64()
        .unwrap_or(0)
        .min(total);
    let end = info["effects"]["trim"]["endMs"]
        .as_u64()
        .map_or(total, |e| e.min(total));
    let ms = end.saturating_sub(start);
    let plan =
        crate::compose::plan_output(sw, sh, settings.aspect, settings.fit, settings.short_side());
    let sound = info["systemFile"].is_string() || info["micFile"].is_string();
    let audio = if sound { 128_000u64 } else { 0 };
    let bytes = (settings.bitrate(plan.w, plan.h, fps) as u64 + audio) * ms / 8000;
    (plan.w, plan.h, ms, bytes)
}

/// What an export will be, for the export dialog: the size of the picture, the length, the rate and the size of the file. A GIF is
/// measured by encoding its first pictures; an MP4 is worked out from its bitrate.
#[tauri::command]
pub async fn estimate_export(
    state: tauri::State<'_, crate::commands::AppState>,
    capture_id: String,
    settings: crate::effects::ExportSettings,
) -> crate::error::CmdResult<serde_json::Value> {
    let (dir, _, _) = recording_for(&state, &capture_id)?;
    #[cfg(windows)]
    {
        let r =
            tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
                let never = std::sync::atomic::AtomicBool::new(false);
                let gif = settings.is_gif();
                if !gif {
                    // An MP4 is worked out from the recording's numbers: nothing is read, so it is instant.
                    let info: serde_json::Value = std::fs::read(dir.join("recording.json"))
                        .ok()
                        .and_then(|b| serde_json::from_slice(&b).ok())
                        .unwrap_or_default();
                    let (w, h, ms, bytes) = mp4_estimate(&info, &settings);
                    return Ok(serde_json::json!({ "width": w, "height": h, "fps": 0, "durationMs": ms, "bytes": bytes }));
                }
                let req = win::Request {
                    dir: &dir,
                    out: dir.join("probe"),
                    settings: settings.clone(),
                    system_volume: 1.0,
                    mic_volume: 1.0,
                    // A GIF: the first 24 pictures; an MP4: nothing is encoded, only the size is looked up.
                    probe: if gif { Some(24) } else { Some(1) },
                };
                let e = win::render(&req, &|_| {}, &never)?;
                let frames_total = (e.duration_ms as f64 / 1000.0 * e.fps as f64)
                    .round()
                    .max(1.0);
                let mean = e.probe_bytes as f64 / e.probe_frames.max(1) as f64;
                let bytes = (mean * frames_total).round() as u64;
                Ok(serde_json::json!({
                    "width": e.width,
                    "height": e.height,
                    "fps": e.fps,
                    "durationMs": e.duration_ms,
                    "bytes": bytes,
                }))
            })
            .await
            .map_err(|e| crate::error::CmdError::new("capture", e.to_string()))?
            .map_err(render_error)?;
        Ok(r)
    }
    #[cfg(not(windows))]
    {
        let _ = (&dir, &settings);
        Err(crate::error::CmdError::new(
            "unsupported",
            "Exporting needs Windows in this version.",
        ))
    }
}

/// Stop the rendering that runs (its partial file is removed).
#[tauri::command]
pub fn cancel_render(job: tauri::State<'_, RenderJob>) {
    job.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
}
