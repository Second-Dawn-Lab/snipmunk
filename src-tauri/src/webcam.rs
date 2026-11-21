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

#[cfg(windows)]
pub use win::{list_devices, Webcam};

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
        pub start_ms: u64,
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
        /// begins with the screen). `start_ms` is where in the recording the webcam begins. The error is a notice for the page:
        /// `webcam-denied` (Windows' privacy setting) or `webcam-none`.
        pub fn start(
            dir: &Path,
            device: &str,
            synthetic: bool,
            start_ms: u64,
            ready: Arc<dyn Fn() -> bool + Send + Sync>,
        ) -> Result<Self, &'static str> {
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
                run(&seg, camera, (w, h, fps), &ready, &stop2);
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

    /// The pictures: a generated pattern at 30 pictures a second, or what the camera gives. Every picture is time stamped on the
    /// clock of the recording (the same as the audio's), counted from the first picture that was kept.
    fn run(
        seg: &Arc<Mutex<Segments>>,
        camera: Option<Camera>,
        (w, h, fps): (u32, u32, u32),
        ready: &Arc<dyn Fn() -> bool + Send + Sync>,
        stop: &AtomicBool,
    ) {
        let (wi, hi) = (w as usize, h as usize);
        let mut begin: Option<i64> = None;
        match camera {
            None => {
                let step = TICKS / fps as i64;
                let mut i = 0usize;
                while !stop.load(Ordering::SeqCst) {
                    if !ready() {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    let b = *begin.get_or_insert_with(now);
                    let frame = crate::recording::flip_rows(&pattern(wi, hi, i), wi, hi);
                    let _ = seg.lock().unwrap().send_buffer(&frame, now() - b);
                    i += 1;
                    let next = b + i as i64 * step;
                    while now() < next && !stop.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                }
            }
            Some(cam) => {
                let full_row = cam.w as usize * 4;
                let mut top_down = vec![0u8; full_row * cam.h as usize];
                while !stop.load(Ordering::SeqCst) {
                    let mut flags = 0u32;
                    let mut sample: Option<IMFSample> = None;
                    // SAFETY: valid out pointers; the buffer is locked only while it is copied.
                    let ok = unsafe {
                        let read = cam.reader.ReadSample(
                            MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
                            0,
                            None,
                            Some(&mut flags),
                            None,
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
                    if !ok || !ready() {
                        continue;
                    }
                    let b = *begin.get_or_insert_with(now);
                    // Cut to the even size of the encoder, then to the order of rows it wants.
                    let mut even = Vec::with_capacity(wi * hi * 4);
                    for y in 0..hi {
                        even.extend_from_slice(&top_down[y * full_row..y * full_row + wi * 4]);
                    }
                    let frame = crate::recording::flip_rows(&even, wi, hi);
                    let _ = seg.lock().unwrap().send_buffer(&frame, now() - b);
                }
            }
        }
    }
}
