//! The webcam of a recording: a video of its own (`webcam.mp4`, recorded as `webcam-000.mp4`, ... segments like the screen, so a crash
//! loses at most the last few seconds), kept in step with the screen by the same clock. The webcam is shown over the video when it is
//! played and exported (`effects.rs`, `compose.rs`); it is never mixed into the screen video.
//!
//! The camera comes from Media Foundation (`MFCreateDeviceSource` + a source reader that gives BGRA pictures). For the development
//! source `__synthetic__` a generated moving pattern is used instead, so the tests never open a real camera. Listing the cameras
//! reads their names only; a camera is opened only when a recording with the webcam on starts.

use serde::Serialize;

/// A camera as the picker lists it (the same shape as the audio devices).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// The id of the generated test camera (listed in debug builds only).
pub const SYNTHETIC: &str = "__synthetic__";

/// A moving test pattern for the generated camera: a colour that shifts, a white disc that circles and a dark stripe.
pub fn pattern(w: usize, h: usize, i: usize) -> Vec<u8> {
    let mut f = vec![255u8; w * h * 4];
    let t = i as f32 / 30.0;
    let (cx, cy) = (
        w as f32 / 2.0 + (t * 2.0).cos() * w as f32 / 4.0,
        h as f32 / 2.0 + (t * 2.0).sin() * h as f32 / 4.0,
    );
    let r = h as f32 / 6.0;
    for y in 0..h {
        for x in 0..w {
            let at = (y * w + x) * 4;
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let px: [u8; 3] = if d < r {
                [255, 255, 255]
            } else {
                // BGR
                [
                    (60.0 + 80.0 * (t * 0.7).sin().abs()) as u8,
                    (x * 160 / w.max(1)) as u8 + 40,
                    (y * 160 / h.max(1)) as u8 + 40,
                ]
            };
            f[at..at + 3].copy_from_slice(&px);
        }
    }
    f
}

/// The newest picture of the camera for the live bubble: small (at most `PREVIEW_WIDTH` wide), BGRA, top row first, with a counter.
/// Is a recording using the camera (its thread then publishes the pictures for the bubble)?
static RECORDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn recording_running() -> bool {
    RECORDING.load(std::sync::atomic::Ordering::SeqCst)
}

pub static PREVIEW: std::sync::Mutex<Option<Preview>> = std::sync::Mutex::new(None);

pub const PREVIEW_WIDTH: usize = 320;

#[derive(Clone)]
pub struct Preview {
    pub counter: u64,
    pub w: usize,
    pub h: usize,
    pub bgra: Vec<u8>,
}

/// Shrink a BGRA picture to at most `PREVIEW_WIDTH` wide by taking every n-th pixel (cheap: no filtering).
pub fn shrink(src: &[u8], w: usize, h: usize) -> (usize, usize, Vec<u8>) {
    let step = w.div_ceil(PREVIEW_WIDTH).max(1);
    let (ow, oh) = (w / step, h / step);
    let mut out = Vec::with_capacity(ow * oh * 4);
    for y in 0..oh {
        let row = &src[y * step * w * 4..];
        for x in 0..ow {
            out.extend_from_slice(&row[x * step * 4..x * step * 4 + 4]);
        }
    }
    (ow, oh, out)
}

/// Keep the newest picture for the bubble (called by the camera thread about 15 times a second).
pub fn publish(src: &[u8], w: usize, h: usize) {
    let (ow, oh, bgra) = shrink(src, w, h);
    let mut g = PREVIEW.lock().unwrap_or_else(|e| e.into_inner());
    let counter = g.as_ref().map_or(1, |p| p.counter + 1);
    *g = Some(Preview {
        counter,
        w: ow,
        h: oh,
        bgra,
    });
}

/// Forget the picture (the camera stopped).
pub fn clear_preview() {
    *PREVIEW.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// The newest picture as a JPEG for the bubble (encoded when it is asked for, so nothing is encoded while nobody looks).
pub fn preview_jpeg() -> Option<Vec<u8>> {
    let p = PREVIEW.lock().unwrap_or_else(|e| e.into_inner()).clone()?;
    let mut rgb = Vec::with_capacity(p.w * p.h * 3);
    for px in p.bgra.as_chunks::<4>().0 {
        rgb.extend_from_slice(&[px[2], px[1], px[0]]);
    }
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 70)
        .encode(&rgb, p.w as u32, p.h as u32, image::ExtendedColorType::Rgb8)
        .ok()?;
    Some(out)
}

#[cfg(windows)]
pub use win::{list_devices, start_preview, Preview as PreviewCamera, Webcam};

#[cfg(windows)]
mod win {
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;
    use std::time::Duration;

    use windows::Win32::Media::MediaFoundation::{
        IMFActivate, IMFAttributes, IMFMediaType, IMFSample, IMFSourceReader, MFCreateAttributes,
        MFCreateMediaType, MFCreateSourceReaderFromMediaSource, MFEnumDeviceSources,
        MFMediaType_Video, MFShutdown, MFStartup, MFVideoFormat_RGB32, MFSTARTUP_FULL,
        MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, MF_MT_DEFAULT_STRIDE,
        MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE,
        MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, MF_SOURCE_READER_FIRST_VIDEO_STREAM, MF_VERSION,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED,
    };

    use super::{pattern, DeviceInfo, SYNTHETIC};
    use crate::audio::{wasapi::now, TICKS};
    use crate::recording::win::Segments;

    /// The attributes that ask for the video cameras.
    unsafe fn camera_query() -> windows::core::Result<IMFAttributes> {
        unsafe {
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 1)?;
            let attrs = attrs.ok_or_else(windows::core::Error::empty)?;
            attrs.SetGUID(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            )?;
            Ok(attrs)
        }
    }

    unsafe fn text(a: &IMFActivate, key: &windows::core::GUID) -> Option<String> {
        unsafe {
            let mut p = windows::core::PWSTR::null();
            let mut n = 0u32;
            a.GetAllocatedString(key, &mut p, &mut n).ok()?;
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(p.0, n as usize));
            CoTaskMemFree(Some(p.0 as *const _));
            Some(s)
        }
    }

    /// The cameras Windows has now. Only their names are read: no camera is opened and no camera light goes on.
    pub fn list_devices() -> Vec<DeviceInfo> {
        let mut out = Vec::new();
        // SAFETY: COM and Media Foundation are started and stopped around the calls; the activation objects are released when
        // dropped and the array they came in is freed as the API requires.
        unsafe {
            let com = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            if MFStartup(MF_VERSION, MFSTARTUP_FULL).is_ok() {
                if let Ok(query) = camera_query() {
                    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
                    let mut count = 0u32;
                    if MFEnumDeviceSources(&query, &mut list, &mut count).is_ok() && !list.is_null()
                    {
                        for i in 0..count as usize {
                            if let Some(a) = (*list.add(i)).take() {
                                let name = text(&a, &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME);
                                let id = text(
                                    &a,
                                    &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                                );
                                if let (Some(name), Some(id)) = (name, id) {
                                    out.push(DeviceInfo {
                                        id,
                                        name,
                                        is_default: i == 0,
                                    });
                                }
                            }
                        }
                        CoTaskMemFree(Some(list as *const _));
                    }
                }
                let _ = MFShutdown();
            }
            if com {
                CoUninitialize();
            }
        }
        if cfg!(debug_assertions) {
            out.push(DeviceInfo {
                id: SYNTHETIC.into(),
                name: "Generated test camera".into(),
                is_default: false,
            });
        }
        out
    }

    /// A running webcam recording.
    pub struct Webcam {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
        segments: Arc<Mutex<Segments>>,
        /// Where in the recording (milliseconds, pauses cut out) the webcam video begins.
        pub start_ms: Arc<std::sync::atomic::AtomicU64>,
        /// The camera that was asked for was not there: the first one is used (the page tells the person).
        pub fell_back: bool,
    }

    /// An opened camera.
    struct Camera {
        reader: IMFSourceReader,
        w: u32,
        h: u32,
        stride: usize,
        bottom_up: bool,
    }

    /// Open the camera `id` ("" = the first). The picture size is what the camera gives (made even for the encoder).
    unsafe fn open_camera(id: &str) -> Result<(Camera, bool), &'static str> {
        unsafe {
            let query = camera_query().map_err(|_| "webcam-none")?;
            let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
            let mut count = 0u32;
            MFEnumDeviceSources(&query, &mut list, &mut count).map_err(|_| "webcam-none")?;
            if list.is_null() || count == 0 {
                return Err("webcam-none");
            }
            let mut chosen = None;
            let mut first = None;
            for i in 0..count as usize {
                if let Some(a) = (*list.add(i)).take() {
                    if first.is_none() {
                        first = Some(a.clone());
                    }
                    if !id.is_empty()
                        && text(&a, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK)
                            .as_deref()
                            == Some(id)
                    {
                        chosen = Some(a);
                    }
                }
            }
            CoTaskMemFree(Some(list as *const _));
            let fell_back = !id.is_empty() && chosen.is_none();
            let activate = chosen.or(first).ok_or("webcam-none")?;
            let source = activate
                .ActivateObject::<windows::Win32::Media::MediaFoundation::IMFMediaSource>()
                .map_err(|e| {
                    if e.code() == windows::Win32::Foundation::E_ACCESSDENIED {
                        "webcam-denied"
                    } else {
                        "webcam-none"
                    }
                })?;
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 1).map_err(|_| "webcam-none")?;
            let attrs = attrs.ok_or("webcam-none")?;
            attrs
                .SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)
                .map_err(|_| "webcam-none")?;
            let reader =
                MFCreateSourceReaderFromMediaSource(&source, &attrs).map_err(|_| "webcam-none")?;
            let wanted: IMFMediaType = MFCreateMediaType().map_err(|_| "webcam-none")?;
            wanted
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|_| "webcam-none")?;
            wanted
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
                .map_err(|_| "webcam-none")?;
            reader
                .SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, None, &wanted)
                .map_err(|_| "webcam-none")?;
            let current = reader
                .GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)
                .map_err(|_| "webcam-none")?;
            let size = current
                .GetUINT64(&MF_MT_FRAME_SIZE)
                .map_err(|_| "webcam-none")?;
            let (w, h) = ((size >> 32) as u32, size as u32);
            let stride = current
                .GetUINT32(&MF_MT_DEFAULT_STRIDE)
                .map(|s| s as i32)
                .unwrap_or(-(w as i32 * 4));
            Ok((
                Camera {
                    reader,
                    w,
                    h,
                    stride: stride.unsigned_abs() as usize,
                    bottom_up: stride < 0,
                },
                fell_back,
            ))
        }
    }

    impl Webcam {
        /// Start recording into `webcam-000.mp4`, ... in `dir`. `device` is a camera id ("" = the first one; `__synthetic__` = the
        /// generated test pattern). Frames are dropped until `ready()` says the screen's first picture has arrived (so the webcam
        /// begins with the screen). Where in the recording the webcam begins is worked out from the time of its first real picture
        /// (`start_ms()`), never from when it was started: opening a camera takes a while. The error is a notice for the page:
        /// `webcam-denied` (Windows' privacy setting) or `webcam-none`.
        pub fn start(
            dir: &Path,
            device: &str,
            synthetic: bool,
            ready: Arc<dyn Fn() -> bool + Send + Sync>,
        ) -> Result<Self, &'static str> {
            let start_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let start_for_thread = start_ms.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let use_synthetic = synthetic || device == SYNTHETIC;
            let fps = 30u32;
            type Opened = Result<(u32, u32, bool, Arc<Mutex<Segments>>), &'static str>;
            let (tx, rx) = std::sync::mpsc::channel::<Opened>();
            let (stop2, dir2, device2) = (stop.clone(), dir.to_path_buf(), device.to_string());
            let thread = std::thread::spawn(move || {
                // SAFETY: COM and Media Foundation are started on this thread and stopped when it ends.
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                    let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL);
                }
                let finish = || unsafe {
                    let _ = MFShutdown();
                    CoUninitialize();
                };
                let (w, h, fell_back, camera) = if use_synthetic {
                    (640u32, 360u32, false, None)
                } else {
                    // SAFETY: the calls follow the Media Foundation rules; the pointers come from the API.
                    match unsafe { open_camera(&device2) } {
                        Ok((c, fb)) => (c.w & !1, c.h & !1, fb, Some(c)),
                        Err(e) => {
                            let _ = tx.send(Err(e));
                            finish();
                            return;
                        }
                    }
                };
                let seg = Arc::new(Mutex::new(
                    Segments::new(
                        &dir2,
                        w,
                        h,
                        fps,
                        "standard",
                        Duration::from_secs(crate::recording::win::SEGMENT_SECONDS),
                    )
                    .named("webcam"),
                ));
                let _ = tx.send(Ok((w, h, fell_back, seg.clone())));
                super::RECORDING.store(true, Ordering::SeqCst);
                // The first picture that is kept: its recorded time is where the webcam begins (and goes to disk at once).
                let json = dir2.join("webcam.json");
                let first = move |ts: i64| {
                    let ms = (crate::audio::recorded_ticks_at(ts) / 10_000) as u64;
                    start_for_thread.store(ms, Ordering::SeqCst);
                    let _ = std::fs::write(&json, format!("{{\"startMs\":{ms}}}"));
                };
                run(Some(&seg), camera, (w, h, fps), &ready, &stop2, &first);
                super::RECORDING.store(false, Ordering::SeqCst);
                super::clear_preview();
                finish();
            });
            let (_, _, fell_back, segments) = rx
                .recv_timeout(Duration::from_secs(8))
                .map_err(|_| "webcam-none")??;
            Ok(Self {
                stop,
                thread: Some(thread),
                segments,
                start_ms,
                fell_back,
            })
        }

        /// A pause ends the segment; no pictures are kept until the resume.
        pub fn pause(&self) {
            self.segments.lock().unwrap().pause();
        }

        pub fn resume(&self) {
            self.segments.lock().unwrap().resume();
        }

        /// Stop the camera and finish the segments: their files, in order.
        pub fn finish(mut self) -> Vec<std::path::PathBuf> {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            self.segments
                .lock()
                .unwrap()
                .finish_all()
                .unwrap_or_default()
        }
    }

    /// A camera that only shows itself (the live bubble before the recording starts): no file is written. Stopped with `stop()`.
    pub struct Preview {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    /// Open the camera `device` for the bubble (`__synthetic__` or `synthetic`: the generated pattern). `Err` is a notice for the page.
    pub fn start_preview(device: &str, synthetic: bool) -> Result<Preview, &'static str> {
        let stop = Arc::new(AtomicBool::new(false));
        let use_synthetic = synthetic || device == SYNTHETIC;
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), &'static str>>();
        let (stop2, device2) = (stop.clone(), device.to_string());
        let thread = std::thread::spawn(move || {
            // SAFETY: COM and Media Foundation are started on this thread and stopped when it ends.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL);
            }
            let (w, h, camera) = if use_synthetic {
                (640u32, 360u32, None)
            } else {
                // SAFETY: the calls follow the Media Foundation rules; the pointers come from the API.
                match unsafe { open_camera(&device2) } {
                    Ok((c, _)) => (c.w & !1, c.h & !1, Some(c)),
                    Err(e) => {
                        let _ = tx.send(Err(e));
                        unsafe {
                            let _ = MFShutdown();
                            CoUninitialize();
                        }
                        return;
                    }
                }
            };
            let _ = tx.send(Ok(()));
            let never: Arc<dyn Fn() -> bool + Send + Sync> = Arc::new(|| false);
            run(None, camera, (w, h, 30), &never, &stop2, &|_| {});
            super::clear_preview();
            unsafe {
                let _ = MFShutdown();
                CoUninitialize();
            }
        });
        rx.recv_timeout(Duration::from_secs(8))
            .map_err(|_| "webcam-none")??;
        Ok(Preview {
            stop,
            thread: Some(thread),
        })
    }

    impl Preview {
        pub fn stop(mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    /// The pictures: a generated pattern at 30 pictures a second, or what the camera gives. Every picture is time stamped on the
    /// clock of the recording (the same as the audio's), counted from the first picture that was kept.
    fn run(
        seg: Option<&Arc<Mutex<Segments>>>,
        camera: Option<Camera>,
        (w, h, fps): (u32, u32, u32),
        ready: &Arc<dyn Fn() -> bool + Send + Sync>,
        stop: &AtomicBool,
        first: &dyn Fn(i64),
    ) {
        let last_preview = std::cell::Cell::new(std::time::Instant::now() - Duration::from_secs(1));
        let preview = |top_down: &[u8], wi: usize, hi: usize| {
            if last_preview.get().elapsed() >= Duration::from_millis(66) {
                last_preview.set(std::time::Instant::now());
                super::publish(top_down, wi, hi);
            }
        };
        let (wi, hi) = (w as usize, h as usize);
        let mut begin: Option<i64> = None;
        match camera {
            None => {
                let step = TICKS / fps as i64;
                let wall0 = now();
                let mut i = 0usize;
                while !stop.load(Ordering::SeqCst) {
                    // A camera does not deliver what it missed (the encoder opening takes a moment): behind schedule, pictures are skipped.
                    let due = ((now()
                        - wall0
                        - crate::audio::CAM_LAG_MS.load(Ordering::Relaxed) as i64 * 10_000)
                        / step)
                        .max(0) as usize;
                    if due > i + 1 {
                        i = due;
                    }
                    // The picture is "taken" at `capture` and handed over `lag` later, like a camera does.
                    let capture = wall0 + i as i64 * step;
                    let lag = crate::audio::CAM_LAG_MS.load(Ordering::Relaxed) as i64 * 10_000;
                    while now() < capture + lag && !stop.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    i += 1;
                    // A generated picture is only made when it is used: for the file every time, for the bubble about 15 times a second.
                    if seg.is_none() && last_preview.get().elapsed() < Duration::from_millis(66) {
                        continue;
                    }
                    let t0 = crate::audio::REC_T0.load(Ordering::SeqCst);
                    let flash = t0 != 0 && crate::audio::sync_mark(capture - t0);
                    let top_down = if flash {
                        vec![255u8; wi * hi * 4]
                    } else {
                        pattern(wi, hi, i)
                    };
                    preview(&top_down, wi, hi);
                    // Pictures are only kept for the recording once the screen's first picture has arrived.
                    if seg.is_some() && !ready() {
                        continue;
                    }
                    let ts = if crate::audio::CAM_ARRIVAL_STAMPS.load(Ordering::Relaxed) {
                        now()
                    } else {
                        capture
                    };
                    let b = *begin.get_or_insert_with(|| {
                        first(ts);
                        ts
                    });
                    if let Some(seg) = seg {
                        let frame = crate::recording::flip_rows(&top_down, wi, hi);
                        let _ = seg.lock().unwrap().send_buffer(&frame, ts - b);
                    }
                }
            }
            Some(cam) => {
                let full_row = cam.w as usize * 4;
                let mut top_down = vec![0u8; full_row * cam.h as usize];
                while !stop.load(Ordering::SeqCst) {
                    let mut flags = 0u32;
                    let mut stamp = 0i64;
                    let mut sample: Option<IMFSample> = None;
                    // SAFETY: valid out pointers; the buffer is locked only while it is copied.
                    let ok = unsafe {
                        let read = cam.reader.ReadSample(
                            MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                            0,
                            None,
                            Some(&mut flags),
                            Some(&mut stamp),
                            Some(&mut sample),
                        );
                        if read.is_err() {
                            break;
                        }
                        match sample.and_then(|s| s.ConvertToContiguousBuffer().ok()) {
                            Some(buffer) => {
                                let mut data = std::ptr::null_mut();
                                let mut len = 0u32;
                                let locked = buffer.Lock(&mut data, None, Some(&mut len)).is_ok();
                                let ok = locked && {
                                    let src = std::slice::from_raw_parts(data, len as usize);
                                    let pitch = crate::render::infer_pitch(
                                        src.len(),
                                        cam.stride.max(full_row),
                                        cam.h as usize,
                                    );
                                    crate::render::copy_rows(
                                        src,
                                        pitch,
                                        cam.h as usize,
                                        full_row,
                                        cam.bottom_up,
                                        &mut top_down,
                                    )
                                };
                                if locked {
                                    let _ = buffer.Unlock();
                                }
                                ok
                            }
                            None => false,
                        }
                    };
                    if !ok {
                        continue;
                    }
                    // Cut to the even size of the encoder.
                    let mut even = Vec::with_capacity(wi * hi * 4);
                    for y in 0..hi {
                        even.extend_from_slice(&top_down[y * full_row..y * full_row + wi * 4]);
                    }
                    preview(&even, wi, hi);
                    let Some(seg) = seg else { continue };
                    if !ready() {
                        continue;
                    }
                    // The camera's own time of the picture (when it was taken, not when it arrived: a camera is 50 to 150 ms late). Camera
                    // sample times are on the system clock (QPC); a time that is far from now is not trusted.
                    let arrived = now();
                    let ts = if stamp > 0
                        && (stamp - arrived).abs() < 5 * TICKS
                        && !crate::audio::CAM_ARRIVAL_STAMPS.load(Ordering::Relaxed)
                    {
                        stamp
                    } else {
                        arrived
                    };
                    let b = *begin.get_or_insert_with(|| {
                        first(ts);
                        ts
                    });
                    let frame = crate::recording::flip_rows(&even, wi, hi);
                    let _ = seg.lock().unwrap().send_buffer(&frame, ts - b);
                }
            }
        }
    }
}

#[cfg(test)]
mod preview_tests {
    use super::*;

    #[test]
    fn a_picture_is_shrunk_for_the_bubble_and_served_as_a_jpeg() {
        let (w, h) = (1280usize, 720usize);
        let src = pattern(w, h, 3);
        let (ow, oh, small) = shrink(&src, w, h);
        assert!((PREVIEW_WIDTH / 2..=PREVIEW_WIDTH).contains(&ow), "{ow}");
        assert_eq!(small.len(), ow * oh * 4);
        // The corner pixel of the shrunk picture is the corner pixel of the picture.
        assert_eq!(&small[..4], &src[..4]);
        publish(&src, w, h);
        let first = PREVIEW.lock().unwrap().as_ref().unwrap().counter;
        publish(&src, w, h);
        assert!(
            PREVIEW.lock().unwrap().as_ref().unwrap().counter > first,
            "every picture has a new number"
        );
        let jpeg = preview_jpeg().unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "a JPEG");
        let img = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((img.width() as usize, img.height() as usize), (ow, oh));
        clear_preview();
        assert!(preview_jpeg().is_none());
    }
}
