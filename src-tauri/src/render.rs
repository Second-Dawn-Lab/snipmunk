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
pub const RENDER_VERSION: u32 = 1;

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
}

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
        Some(Self { points, shapes })
    }

    /// Draw the cursor on a BGRA picture (top row first) for the time `ms`: the position is interpolated between the samples.
    pub fn draw(&self, frame: &mut [u8], w: u32, h: u32, ms: u64) {
        let i = self.points.partition_point(|p| p.0 <= ms);
        let Some(a) = i
            .checked_sub(1)
            .and_then(|i| self.points.get(i))
            .or(self.points.first())
        else {
            return;
        };
        let (mut x, mut y) = (a.1 as f64, a.2 as f64);
        if let Some(b) = self.points.get(i) {
            if i > 0 && b.0 > a.0 && b.3 {
                let k = ((ms - a.0) as f64 / (b.0 - a.0) as f64).clamp(0.0, 1.0);
                x += (b.1 - a.1) as f64 * k;
                y += (b.2 - a.2) as f64 * k;
            }
        }
        if !a.3 {
            return;
        }
        if let Some((img, hx, hy)) = self.shapes.get(&a.4) {
            blend_cursor(
                frame,
                w,
                h,
                img,
                x.round() as i32 - hx,
                y.round() as i32 - hy,
            );
        }
    }
}

/// What the rendered file is made from, as text: when it changes the file is made again.
pub fn cache_key(dir: &Path, system_volume: f32, mic_volume: f32) -> String {
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
        "v{RENDER_VERSION}|screen {}|system {}|mic {}|cursor {}|vol {system_volume:.2} {mic_volume:.2}",
        stamp("screen.mp4"),
        stamp("system.wav"),
        stamp("mic.wav"),
        stamp("cursor.jsonl"),
    )
}

/// Is `final.mp4` there and made from what is there now?
pub fn is_fresh(dir: &Path, key: &str) -> bool {
    dir.join("final.mp4").is_file()
        && std::fs::read_to_string(dir.join("final.key")).is_ok_and(|k| k == key)
}

/// What a render did.
#[derive(Debug, Clone, PartialEq)]
pub struct Rendered {
    pub file: PathBuf,
    pub frames: u64,
    pub seconds: f64,
    /// False when `final.mp4` was there already.
    pub made: bool,
}

#[cfg(windows)]
pub mod win {
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::core::PCWSTR;
    use windows::Win32::Media::MediaFoundation::{
        IMFAttributes, IMFMediaType, IMFSample, IMFSourceReader, MFCreateAttributes,
        MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Video, MFShutdown, MFStartup,
        MFVideoFormat_RGB32, MFSTARTUP_FULL, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_SIZE,
        MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_SOURCE_READERF_ENDOFSTREAM,
        MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, MF_SOURCE_READER_FIRST_VIDEO_STREAM, MF_VERSION,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows_capture::encoder::{
        AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
        VideoSettingsSubType,
    };

    use super::{cache_key, is_fresh, mix_next, CursorLayer, Rendered, TrackReader, OUT_RATE};
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

    fn open_reader(path: &Path) -> Result<(IMFSourceReader, u32, u32, bool), String> {
        let wide: Vec<u16> = path.as_os_str().encode_wide_nul();
        // SAFETY: COM/MF calls with valid arguments; `wide` is NUL-terminated.
        unsafe {
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 1).map_err(|e| e.to_string())?;
            let attrs = attrs.ok_or("no attributes")?;
            attrs
                .SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)
                .map_err(|e| e.to_string())?;
            let reader = MFCreateSourceReaderFromURL(PCWSTR(wide.as_ptr()), &attrs)
                .map_err(|e| e.to_string())?;
            let wanted: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
            wanted
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| e.to_string())?;
            wanted
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
                .map_err(|e| e.to_string())?;
            reader
                .SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, None, &wanted)
                .map_err(|e| e.to_string())?;
            let current = reader
                .GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)
                .map_err(|e| e.to_string())?;
            let size = current
                .GetUINT64(&MF_MT_FRAME_SIZE)
                .map_err(|e| e.to_string())?;
            let (w, h) = ((size >> 32) as u32, size as u32);
            // RGB pictures are bottom-up when the stride is negative (the usual case for Windows bitmaps).
            let bottom_up = current
                .GetUINT32(&MF_MT_DEFAULT_STRIDE)
                .map(|s| (s as i32) < 0)
                .unwrap_or(true);
            Ok((reader, w, h, bottom_up))
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
    fn decode(path: &Path, tx: &std::sync::mpsc::SyncSender<Msg>, cancel: &AtomicBool) {
        let run = || -> Result<(), String> {
            let _mf = Mf::start()?;
            let (reader, w, h, bottom_up) = open_reader(path)?;
            if tx.send(Msg::Size(w, h)).is_err() {
                return Ok(());
            }
            let row = w as usize * 4;
            let need = row * h as usize;
            while !cancel.load(Ordering::SeqCst) {
                let mut flags = 0u32;
                let mut ts = 0i64;
                let mut sample: Option<IMFSample> = None;
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
                let Some(sample) = sample else { continue };
                let mut top_down = vec![0u8; need];
                // SAFETY: the buffer is locked for the copy and unlocked right after; `len` bytes are valid while locked.
                let ok = unsafe {
                    let buffer = sample
                        .ConvertToContiguousBuffer()
                        .map_err(|e| e.to_string())?;
                    let mut data = std::ptr::null_mut();
                    let mut len = 0u32;
                    buffer
                        .Lock(&mut data, None, Some(&mut len))
                        .map_err(|e| e.to_string())?;
                    let src = std::slice::from_raw_parts(data, len as usize);
                    let ok = src.len() >= need;
                    if ok {
                        if bottom_up {
                            // The picture is stored bottom row first: top-down for drawing.
                            for (y, dst) in top_down.chunks_exact_mut(row).enumerate() {
                                let from = (h as usize - 1 - y) * row;
                                dst.copy_from_slice(&src[from..from + row]);
                            }
                        } else {
                            top_down.copy_from_slice(&src[..need]);
                        }
                    }
                    let _ = buffer.Unlock();
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

    /// Make `final.mp4` in the recording folder `dir` (unless it is fresh): the screen video, the cursor drawn on it, the tracks
    /// mixed. `progress` gets 0..1; the render stops (and removes its partial file) when `cancel` is set. Decoding, drawing and
    /// encoding run on three threads, so the slowest of the three sets the speed.
    pub fn render(
        dir: &Path,
        system_volume: f32,
        mic_volume: f32,
        progress: &dyn Fn(f32),
        cancel: &AtomicBool,
    ) -> Result<Rendered, String> {
        let key = cache_key(dir, system_volume, mic_volume);
        let out = dir.join("final.mp4");
        if is_fresh(dir, &key) {
            return Ok(Rendered {
                file: out,
                frames: 0,
                seconds: 0.0,
                made: false,
            });
        }
        let started = std::time::Instant::now();
        let info: RecordingInfo = std::fs::read(dir.join("recording.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let fps = if info.fps == 0 { 30 } else { info.fps };
        let total_ms = info.duration_ms.max(1);

        let mut tracks = Vec::new();
        for (name, vol) in [("system.wav", system_volume), ("mic.wav", mic_volume)] {
            if dir.join(name).is_file() {
                if let Ok(t) = TrackReader::open(&dir.join(name), vol) {
                    tracks.push(t);
                }
            }
        }
        let cursor = info
            .cursor_file
            .as_deref()
            .and_then(|f| CursorLayer::load(dir, f));

        let (tx, rx) = std::sync::mpsc::sync_channel::<Msg>(6);
        let screen = dir.join("screen.mp4");
        let stop = AtomicBool::new(false);
        let result = std::thread::scope(|scope| -> Result<Rendered, String> {
            let decoder = scope.spawn(|| {
                // Cancelling the render also stops the decoder.
                decode(&screen, &tx, &stop)
            });
            let outcome = (|| -> Result<Rendered, String> {
                let (w, h) = match rx.recv().map_err(|e| e.to_string())? {
                    Msg::Size(w, h) => (w, h),
                    Msg::Failed(e) => return Err(e),
                    _ => return Err("the video could not be read".into()),
                };
                let part = dir.join("final.mp4.part");
                let mut encoder = VideoEncoder::new(
                    VideoSettingsBuilder::new(w & !1, h & !1)
                        .sub_type(VideoSettingsSubType::H264)
                        .frame_rate(fps)
                        .bitrate(crate::recording::bitrate_for(w, h, fps, "high")),
                    AudioSettingsBuilder::default()
                        .disabled(tracks.is_empty())
                        .sample_rate(OUT_RATE)
                        .channel_count(2)
                        .bit_per_sample(16),
                    ContainerSettingsBuilder::default(),
                    &part,
                )
                .map_err(|e| e.to_string())?;
                let mut frames = 0u64;
                let mut audio_fed: u64 = 0;
                loop {
                    if cancel.load(Ordering::SeqCst) {
                        drop(encoder);
                        let _ = std::fs::remove_file(&part);
                        return Err("cancelled".into());
                    }
                    let (ts, mut picture) = match rx.recv().map_err(|e| e.to_string())? {
                        Msg::Frame(ts, p) => (ts, p),
                        Msg::End => break,
                        Msg::Failed(e) => {
                            drop(encoder);
                            let _ = std::fs::remove_file(&part);
                            return Err(e);
                        }
                        Msg::Size(..) => continue,
                    };
                    let ms = (ts / 10_000).max(0) as u64;
                    if let Some(c) = &cursor {
                        c.draw(&mut picture, w, h, ms);
                    }
                    // The encoder reads a raw buffer bottom-up (see recording::flip_rows).
                    let frame = crate::recording::flip_rows(&picture, w as usize, h as usize);
                    encoder
                        .send_frame_buffer(&frame, ts)
                        .map_err(|e| e.to_string())?;
                    frames += 1;
                    // The sound up to this picture.
                    if !tracks.is_empty() {
                        let wanted = (ts.max(0) as u128 * OUT_RATE as u128 / 10_000_000) as u64;
                        while audio_fed < wanted {
                            let n = ((wanted - audio_fed) as usize).min(4800);
                            let bytes = mix_next(&mut tracks, n);
                            encoder
                                .send_audio_buffer(&bytes, 0)
                                .map_err(|e| e.to_string())?;
                            audio_fed += n as u64;
                        }
                    }
                    if frames.is_multiple_of(15) {
                        progress((ms as f32 / total_ms as f32).clamp(0.0, 1.0));
                    }
                }
                encoder.finish().map_err(|e| e.to_string())?;
                std::fs::rename(&part, &out).map_err(|e| e.to_string())?;
                std::fs::write(dir.join("final.key"), &key).map_err(|e| e.to_string())?;
                progress(1.0);
                Ok(Rendered {
                    file: out.clone(),
                    frames,
                    seconds: started.elapsed().as_secs_f64(),
                    made: true,
                })
            })();
            // Whatever happened: the decoder is told to stop and its channel is emptied, so it cannot wait on a full channel.
            stop.store(true, Ordering::SeqCst);
            while rx.try_recv().is_ok() {}
            drop(rx);
            let _ = decoder.join();
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
        let key = cache_key(dir.path(), 1.0, 1.0);
        assert!(!is_fresh(dir.path(), &key), "nothing rendered yet");
        std::fs::write(dir.path().join("final.mp4"), b"r").unwrap();
        std::fs::write(dir.path().join("final.key"), &key).unwrap();
        assert!(is_fresh(dir.path(), &key));
        assert_ne!(key, cache_key(dir.path(), 0.5, 1.0), "a volume changed");
        std::fs::write(dir.path().join("system.wav"), b"audio").unwrap();
        assert_ne!(key, cache_key(dir.path(), 1.0, 1.0), "a track appeared");
        assert!(!is_fresh(dir.path(), &cache_key(dir.path(), 1.0, 1.0)));
    }
}

/// The rendering that runs, and whether it is to stop. One at a time.
#[derive(Default)]
pub struct RenderJob {
    running: std::sync::atomic::AtomicBool,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// Render a recording (see the module text) and tell the page how far it is (`render-progress`: capture id, 0..1). Returns the
/// path of `final.mp4` and of the picture of the recording (for the drag). The files are then allowed for Save, Copy, drag and Share.
#[tauri::command]
pub async fn render_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::commands::AppState>,
    job: tauri::State<'_, RenderJob>,
    capture_id: String,
) -> crate::error::CmdResult<serde_json::Value> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    let dir = state
        .sessions
        .lock()
        .unwrap()
        .recording_dir(&capture_id)
        .ok_or_else(|| crate::error::CmdError::new("not_found", "this recording does not exist"))?;
    if job.running.swap(true, Ordering::SeqCst) {
        return Err(crate::error::CmdError::new(
            "busy",
            "a video is being rendered already",
        ));
    }
    job.cancel.store(false, Ordering::SeqCst);
    let cancel = job.cancel.clone();
    let (app2, id2, dir2) = (app.clone(), capture_id.clone(), dir.clone());
    let done = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let progress = |p: f32| {
                let _ = app2.emit(
                    "render-progress",
                    serde_json::json!({ "captureId": id2, "progress": p }),
                );
            };
            win::render(&dir2, 1.0, 1.0, &progress, &cancel)
        }
        #[cfg(not(windows))]
        {
            let _ = (&app2, &id2, &dir2, &cancel);
            Err::<Rendered, String>("Rendering needs Windows in this version.".into())
        }
    })
    .await;
    job.running.store(false, Ordering::SeqCst);
    let rendered = done
        .map_err(|e| crate::error::CmdError::new("capture", e.to_string()))?
        .map_err(|e| {
            if e == "cancelled" {
                crate::error::CmdError::new("cancelled", "the rendering was cancelled")
            } else {
                crate::error::CmdError::new("capture", e)
            }
        })?;
    let thumb = dir.join("first.png");
    crate::export::allow_file(&rendered.file);
    crate::export::allow_file(&thumb);
    Ok(serde_json::json!({
        "file": rendered.file.to_string_lossy(),
        "thumb": thumb.to_string_lossy(),
        "made": rendered.made,
        "seconds": rendered.seconds,
    }))
}

/// Stop the rendering that runs (its partial file is removed).
#[tauri::command]
pub fn cancel_render(job: tauri::State<'_, RenderJob>) {
    job.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
}
