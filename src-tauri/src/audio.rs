//! The audio of a recording: the system sound (WASAPI loopback of the default output) and the microphone (the default input) are
//! written as two SEPARATE tracks (`system.wav`, `mic.wav`), next to the video.
//!
//! * `TrackWriter` keeps a track in step with the recording clock: the length of the track always matches the recorded time. A
//!   loopback device sends nothing while nothing plays, and a device clock runs a little fast or slow: the writer fills gaps with
//!   silence and drops what is too much, working from the time stamps of the packets. A pause writes nothing (like the video).
//!   It has no Windows code, so it is tested with generated tones.
//! * `wasapi` (Windows only) feeds a `TrackWriter` from a device.
//! * A track is a normal 16 bit PCM WAV file. The header is brought up to date every second, so a crash leaves a readable file;
//!   `repair` fixes the header of a file a crash cut off.

use std::fs::File;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const HEADER: u64 = 44;
/// 100 ns units per second (the unit of the time stamps).
pub const TICKS: i64 = 10_000_000;

fn header(rate: u32, channels: u16, data_bytes: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    let block = channels as u32 * 2;
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&(rate * block).to_le_bytes());
    h[32..34].copy_from_slice(&(block as u16).to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

/// A WAV file that is written as it goes.
pub struct WavWriter {
    file: File,
    rate: u32,
    channels: u16,
    data_bytes: u64,
    since_header: u64,
}

impl WavWriter {
    pub fn create(path: &Path, rate: u32, channels: u16) -> io::Result<Self> {
        let mut file = File::create(path)?;
        file.write_all(&header(rate, channels, 0))?;
        Ok(Self {
            file,
            rate,
            channels,
            data_bytes: 0,
            since_header: 0,
        })
    }

    pub fn write(&mut self, samples: &[i16]) -> io::Result<()> {
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        self.file.write_all(&bytes)?;
        self.data_bytes += bytes.len() as u64;
        self.since_header += bytes.len() as u64;
        // About a second of audio: the header is made right again, so a crash leaves a file that plays.
        if self.since_header >= self.rate as u64 * self.channels as u64 * 2 {
            self.update_header()?;
        }
        Ok(())
    }

    fn update_header(&mut self) -> io::Result<()> {
        let end = self.file.stream_position()?;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(&header(
            self.rate,
            self.channels,
            self.data_bytes.min(u32::MAX as u64) as u32,
        ))?;
        self.file.seek(SeekFrom::Start(end))?;
        self.since_header = 0;
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<()> {
        self.update_header()?;
        self.file.sync_all()
    }
}

/// Make the header of a WAV file match its size (after a crash); with `max_ms` the file is also cut to that length.
/// Returns the length in milliseconds.
pub fn repair(path: &Path, max_ms: Option<u64>) -> io::Result<u64> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;
    let mut h = [0u8; 44];
    io::Read::read_exact(&mut file, &mut h)?;
    let channels = u16::from_le_bytes([h[22], h[23]]).max(1);
    let rate = u32::from_le_bytes([h[24], h[25], h[26], h[27]]).max(1);
    let block = channels as u64 * 2;
    let size = file.metadata()?.len();
    let mut data = size.saturating_sub(HEADER) / block * block;
    if let Some(ms) = max_ms {
        data = data.min(ms * rate as u64 / 1000 * block);
    }
    file.set_len(HEADER + data)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&header(rate, channels, data as u32))?;
    file.sync_all()?;
    Ok(data / block * 1000 / rate as u64)
}

/// The length of a WAV file in milliseconds from its header (0 when it is not one of ours).
pub fn wav_ms(path: &Path) -> u64 {
    let Ok(mut f) = File::open(path) else {
        return 0;
    };
    let mut h = [0u8; 44];
    if io::Read::read_exact(&mut f, &mut h).is_err() || &h[0..4] != b"RIFF" {
        return 0;
    }
    let channels = u16::from_le_bytes([h[22], h[23]]).max(1) as u64;
    let rate = u32::from_le_bytes([h[24], h[25], h[26], h[27]]).max(1) as u64;
    let data = u32::from_le_bytes([h[40], h[41], h[42], h[43]]) as u64;
    data / (channels * 2) * 1000 / rate
}

/// How far the track may be off before the writer corrects it: 20 ms.
const TOLERANCE_MS: i64 = 20;

/// One audio track kept in step with the recording clock (see the module text).
pub struct TrackWriter {
    wav: Option<WavWriter>,
    rate: u32,
    channels: usize,
    /// The clock value (100 ns units) of the start of the recording.
    t0: i64,
    /// Frames written so far (one frame = one sample per channel).
    written: u64,
    paused_since: Option<i64>,
    paused_total: i64,
    /// Silence is written instead of the sound while this is false (the mute button of the bar).
    enabled: Arc<AtomicBool>,
    /// The recording clock has not started yet (the first picture has not arrived): nothing is written.
    waiting: bool,
    /// How many frames were added as silence and how many were dropped, to tell how much the device clock drifted.
    pub filled: u64,
    pub dropped: u64,
}

impl TrackWriter {
    pub fn create(
        path: &Path,
        rate: u32,
        channels: u16,
        t0: i64,
        enabled: Arc<AtomicBool>,
    ) -> io::Result<Self> {
        Ok(Self {
            wav: Some(WavWriter::create(path, rate, channels)?),
            rate,
            channels: channels as usize,
            t0,
            written: 0,
            paused_since: None,
            paused_total: 0,
            enabled,
            waiting: false,
            filled: 0,
            dropped: 0,
        })
    }

    /// Write nothing until `begin`: the clock of the recording starts with its first picture, so the sound is in step with it.
    pub fn wait_for_start(&mut self) {
        self.waiting = true;
    }

    /// The recording clock starts now: `t0` is its value.
    pub fn begin(&mut self, t0: i64) {
        self.t0 = t0;
        self.waiting = false;
    }

    fn frames_at(&self, now: i64) -> i64 {
        let media = now - self.t0 - self.paused_total;
        (media as i128 * self.rate as i128 / TICKS as i128) as i64
    }

    fn write(&mut self, samples: &[i16]) {
        if let Some(w) = self.wav.as_mut() {
            if w.write(samples).is_err() {
                self.wav = None; // a full disk: the track ends here, the recording goes on
            }
        }
        self.written += (samples.len() / self.channels) as u64;
    }

    fn silence(&mut self, frames: u64) {
        let chunk = vec![0i16; self.rate as usize * self.channels / 4];
        let mut left = frames as usize * self.channels;
        while left > 0 {
            let n = left.min(chunk.len());
            self.write(&chunk[..n]);
            left -= n;
        }
    }

    /// A packet from the device: `samples` are interleaved, `ts` is the time (100 ns units, the recording clock) of its first frame.
    pub fn push(&mut self, samples: &[f32], ts: i64) {
        if self.waiting || self.paused_since.is_some() {
            return;
        }
        let tol = self.rate as i64 * TOLERANCE_MS / 1000;
        let gap = self.frames_at(ts) - self.written as i64;
        let mut start = 0usize;
        if gap > tol {
            self.silence(gap as u64);
            self.filled += gap as u64;
        } else if gap < -tol {
            // Ahead of the clock (a fast device): the part that is too much is dropped.
            let drop = (-gap) as usize * self.channels;
            start = drop.min(samples.len());
            self.dropped += (start / self.channels) as u64;
        }
        let on = self.enabled.load(Ordering::Relaxed);
        let out: Vec<i16> = samples[start..]
            .iter()
            .map(|s| {
                if on {
                    (s.clamp(-1.0, 1.0) * 32767.0) as i16
                } else {
                    0
                }
            })
            .collect();
        self.write(&out);
    }

    /// Called often, also when the device sends nothing: silence up to \`now\` is written when the track is too short.
    pub fn tick(&mut self, now: i64) {
        if self.waiting || self.paused_since.is_some() {
            return;
        }
        // A packet that is late by a few buffers is not a gap yet: wait 100 ms.
        let late = self.frames_at(now) - self.written as i64 - self.rate as i64 / 10;
        if late > 0 {
            let frames = self.frames_at(now) - self.written as i64;
            self.silence(frames as u64);
            self.filled += frames as u64;
        }
    }

    pub fn pause(&mut self, now: i64) {
        if self.paused_since.is_none() {
            self.tick(now);
            self.paused_since = Some(now);
        }
    }

    pub fn resume(&mut self, now: i64) {
        if let Some(since) = self.paused_since.take() {
            self.paused_total += now - since;
        }
    }

    /// The track as long as the recorded time and closed.
    pub fn finish(&mut self, now: i64) -> io::Result<u64> {
        self.tick(now);
        let frames = self.written;
        if let Some(w) = self.wav.take() {
            w.finish()?;
        }
        Ok(frames * 1000 / self.rate as u64)
    }

    #[cfg(test)]
    pub fn written_frames(&self) -> u64 {
        self.written
    }
}

/// Which track.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    System,
    Mic,
}

impl Kind {
    pub fn file_name(self) -> &'static str {
        match self {
            Kind::System => "system.wav",
            Kind::Mic => "mic.wav",
        }
    }
}

pub fn track_path(dir: &Path, kind: Kind) -> PathBuf {
    dir.join(kind.file_name())
}

/// Why a device could not be opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudioError {
    /// Windows' privacy setting (or a policy) does not let apps use the microphone.
    Denied,
    /// There is no default device.
    NoDevice,
    Other(String),
}

// ---- the clock of the running recording ---------------------------------------------------------------------------------------

/// The clock value (100 ns, the QPC clock of `wasapi::now`) of the first picture of the recording that runs; 0 before it. Every track
/// is counted from it: screen, sound, cursor and webcam. Generated sources read it to flash and beep at known recorded times.
pub static REC_T0: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

/// Generated sources (tests only): the generated camera flashes white and the generated tones beep for 100 ms at the start of every
/// recorded second, so the sync of the tracks can be measured.
pub static SYNC_TEST: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// How late the generated camera delivers its pictures, in milliseconds (a real camera is 50 to 150 ms late); tests only.
pub static CAM_LAG_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Time the webcam pictures by their arrival instead of the camera's own time (the old behaviour; tests measure it).
pub static CAM_ARRIVAL_STAMPS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// The pauses of the running recording as (start, end) clock values; an open pause has `i64::MAX` as its end.
static PAUSES: std::sync::Mutex<Vec<(i64, i64)>> = std::sync::Mutex::new(Vec::new());

/// A new recording starts: its clock is not known yet and it has no pauses.
pub fn reset_clock() {
    REC_T0.store(0, std::sync::atomic::Ordering::SeqCst);
    PAUSES.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

pub fn clock_pause(now: i64) {
    PAUSES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push((now, i64::MAX));
}

pub fn clock_resume(now: i64) {
    if let Some(p) = PAUSES.lock().unwrap_or_else(|e| e.into_inner()).last_mut() {
        if p.1 == i64::MAX {
            p.1 = now;
        }
    }
}

/// The recorded time (100 ns, pauses cut out) of a clock value `ts`; 0 before the first picture.
pub fn recorded_ticks_at(ts: i64) -> i64 {
    let t0 = REC_T0.load(std::sync::atomic::Ordering::SeqCst);
    if t0 == 0 || ts <= t0 {
        return 0;
    }
    let paused: i64 = PAUSES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|&(a, b)| (b.min(ts) - a.max(t0)).max(0))
        .sum();
    ts - t0 - paused
}

/// Does the generated source make a mark (a flash, a beep) at this recorded time? The first 100 ms of every second.
pub fn sync_mark(recorded_ticks: i64) -> bool {
    SYNC_TEST.load(std::sync::atomic::Ordering::Relaxed)
        && recorded_ticks >= 0
        && recorded_ticks.rem_euclid(TICKS) < TICKS / 10
}

#[cfg(windows)]
pub mod wasapi {
    //! The Windows devices. Nothing here runs in the tests (it would record the real sound of the computer): the logic that matters
    //! is in `TrackWriter`, which the tests drive with generated tones.

    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;
    use std::time::Duration;

    use windows::core::PCWSTR;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::E_ACCESSDENIED;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice,
        IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::STGM_READ;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    use super::{AudioError, Kind, TrackWriter, TICKS};

    /// The clock of the recording in 100 ns units (the same unit as the time stamps of the packets: QPC based).
    pub fn now() -> i64 {
        let mut f = 0i64;
        let mut c = 0i64;
        // SAFETY: both pointers are valid for the calls.
        unsafe {
            let _ = windows::Win32::System::Performance::QueryPerformanceFrequency(&mut f);
            let _ = windows::Win32::System::Performance::QueryPerformanceCounter(&mut c);
        }
        (c as i128 * TICKS as i128 / f.max(1) as i128) as i64
    }

    pub struct Capture {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl Capture {
        pub fn stop(mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    fn map(e: windows::core::Error) -> AudioError {
        if e.code() == E_ACCESSDENIED {
            AudioError::Denied
        } else {
            AudioError::Other(e.message())
        }
    }

    /// An audio endpoint as the pickers show it.
    #[derive(Debug, Clone, serde::Serialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct DeviceInfo {
        pub id: String,
        pub name: String,
        /// The Windows default of its kind.
        pub is_default: bool,
    }

    /// The names are read without opening the device (no microphone is ever started by listing).
    unsafe fn describe(device: &IMMDevice) -> Option<(String, String)> {
        unsafe {
            let id_ptr = device.GetId().ok()?;
            let id = id_ptr.to_string().ok();
            CoTaskMemFree(Some(id_ptr.0 as *const _));
            let store = device.OpenPropertyStore(STGM_READ).ok()?;
            let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
            // A friendly name is a string property (VT_LPWSTR): its text.
            let name = value.to_string();
            Some((id?, name))
        }
    }

    /// The active capture endpoints (microphones) and render endpoints (outputs whose sound can be recorded), with the default of each.
    pub fn list_devices() -> (Vec<DeviceInfo>, Vec<DeviceInfo>) {
        // SAFETY: COM is initialised for the call and released; the pointers come from the API and are freed as it requires.
        unsafe {
            let initialised = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let mut out = (Vec::new(), Vec::new());
            if let Ok(enumerator) =
                CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            {
                for (flow, list) in [(eCapture, &mut out.0), (eRender, &mut out.1)] {
                    let default_id = enumerator
                        .GetDefaultAudioEndpoint(flow, eConsole)
                        .ok()
                        .and_then(|d| describe(&d))
                        .map(|(id, _)| id);
                    if let Ok(all) = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) {
                        for i in 0..all.GetCount().unwrap_or(0) {
                            if let Some((id, name)) = all.Item(i).ok().and_then(|d| describe(&d)) {
                                let is_default = Some(&id) == default_id.as_ref();
                                list.push(DeviceInfo {
                                    id,
                                    name,
                                    is_default,
                                });
                            }
                        }
                    }
                }
            }
            if initialised {
                CoUninitialize();
            }
            out
        }
    }

    /// Open the device `id` of the kind (the Windows default when `id` is empty or the device is gone: then the flag in the result
    /// says so): the format, the initialised client and whether the default was used instead of the chosen device.
    fn open(kind: Kind, id: &str) -> Result<(u32, u16, IAudioClient, bool), AudioError> {
        // SAFETY: COM calls on this thread; every pointer comes from the API and is freed as it requires.
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(map)?;
            let flow = if kind == Kind::System {
                eRender
            } else {
                eCapture
            };
            let mut fell_back = false;
            let chosen = if id.is_empty() {
                None
            } else {
                let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
                let found = enumerator
                    .GetDevice(PCWSTR(wide.as_ptr()))
                    .ok()
                    .filter(|d| {
                        d.GetState()
                            .map(|s| s == DEVICE_STATE_ACTIVE)
                            .unwrap_or(false)
                    });
                fell_back = found.is_none();
                found
            };
            let device = match chosen {
                Some(d) => d,
                None => enumerator
                    .GetDefaultAudioEndpoint(flow, eConsole)
                    .map_err(|e| {
                        if e.code() == E_ACCESSDENIED {
                            AudioError::Denied
                        } else {
                            AudioError::NoDevice
                        }
                    })?,
            };
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(map)?;
            let fmt = client.GetMixFormat().map_err(map)?;
            let (rate, channels) = ((*fmt).nSamplesPerSec, (*fmt).nChannels);
            let flags = if kind == Kind::System {
                AUDCLNT_STREAMFLAGS_LOOPBACK
            } else {
                0
            };
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 1_000_000, 0, fmt, None);
            CoTaskMemFree(Some(fmt as *const _));
            init.map_err(map)?;
            Ok((rate, channels, client, fell_back))
        }
    }

    /// Start capturing the default device into the file `path` on its own thread. Errors of the device are returned here (the thread
    /// goes on only when the device opened). `t0` is the clock value of the start of the recording; `enabled` is the mute switch.
    pub fn start(
        kind: Kind,
        device: &str,
        path: &Path,
        t0: i64,
        waiting: bool,
        enabled: Arc<AtomicBool>,
    ) -> Result<(Capture, Arc<Mutex<TrackWriter>>, bool), AudioError> {
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) =
            std::sync::mpsc::channel::<Result<(Arc<Mutex<TrackWriter>>, bool), AudioError>>();
        let device = device.to_string();
        let stop2 = stop.clone();
        let path = path.to_path_buf();
        let thread = std::thread::spawn(move || {
            // SAFETY: COM is initialised and released on this thread.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let opened = open(kind, &device).and_then(|(rate, channels, client, fell_back)| {
                let mut writer = TrackWriter::create(&path, rate, channels, t0, enabled)
                    .map_err(|e| AudioError::Other(e.to_string()))?;
                if waiting {
                    writer.wait_for_start();
                }
                // SAFETY: the client is initialised.
                unsafe {
                    let capture: IAudioCaptureClient = client.GetService().map_err(map)?;
                    client.Start().map_err(map)?;
                    Ok((client, capture, Arc::new(Mutex::new(writer)), fell_back))
                }
            });
            let (client, capture, writer) = match opened {
                Ok((client, capture, writer, fell_back)) => {
                    let _ = tx.send(Ok((writer.clone(), fell_back)));
                    (client, capture, writer)
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                    // SAFETY: balances the CoInitializeEx above.
                    unsafe { CoUninitialize() };
                    return;
                }
            };
            while !stop2.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(10));
                // SAFETY: the buffer pointer is valid between GetBuffer and ReleaseBuffer and holds `frames` frames of the
                // shared-mode mix format, which Windows defines as 32 bit float.
                unsafe {
                    while let Ok(n) = capture.GetNextPacketSize() {
                        if n == 0 {
                            break;
                        }
                        let mut data = std::ptr::null_mut();
                        let (mut frames, mut flags, mut qpc) = (0u32, 0u32, 0u64);
                        if capture
                            .GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc))
                            .is_err()
                        {
                            break;
                        }
                        let mut w = writer.lock().unwrap();
                        let count = frames as usize * w.channel_count();
                        let samples: Vec<f32> =
                            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                                vec![0.0; count]
                            } else {
                                std::slice::from_raw_parts(data as *const f32, count).to_vec()
                            };
                        w.push(&samples, qpc as i64);
                        drop(w);
                        let _ = capture.ReleaseBuffer(frames);
                    }
                }
                writer.lock().unwrap().tick(now());
            }
            // SAFETY: stops the client that was started above.
            unsafe {
                let _ = client.Stop();
                CoUninitialize();
            }
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok((writer, fell_back))) => Ok((
                Capture {
                    stop,
                    thread: Some(thread),
                },
                writer,
                fell_back,
            )),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                stop.store(true, Ordering::SeqCst);
                Err(AudioError::Other("the audio device did not answer".into()))
            }
        }
    }
}

/// Where the sound of a track comes from.
#[cfg(windows)]
enum Source {
    Device(wasapi::Capture),
    /// A generated tone (the development source `__synthetic__`): the stop flag and the thread.
    Tone(Arc<AtomicBool>, std::thread::JoinHandle<()>),
}

#[cfg(windows)]
struct Track {
    writer: Arc<std::sync::Mutex<TrackWriter>>,
    enabled: Arc<AtomicBool>,
    source: Source,
}

/// The audio of a running recording: up to two tracks. A track is made the first time its sound is switched on (so the
/// microphone is never opened while it is off); switching it off later only mutes it (the track stays as long as the recording).
#[cfg(windows)]
pub struct Audio {
    dir: PathBuf,
    t0: i64,
    /// The clock of the recording has started (the first picture arrived).
    started: bool,
    synthetic: bool,
    system: Option<Track>,
    mic: Option<Track>,
    /// Why a track could not be made: "mic-denied" (Windows privacy), "mic-none", "system-none". Read once by the start.
    pub notice: Option<&'static str>,
    /// The devices that were chosen in the settings ("" = the Windows default).
    pub mic_device: String,
    pub system_device: String,
}

#[cfg(windows)]
impl Audio {
    pub fn new(dir: &Path, synthetic: bool) -> Self {
        Self {
            dir: dir.to_path_buf(),
            t0: wasapi::now(),
            started: false,
            synthetic,
            system: None,
            mic: None,
            notice: None,
            mic_device: String::new(),
            system_device: String::new(),
        }
    }

    /// The first picture arrived: the clock of the recording starts now, for the tracks that exist and the ones to come.
    pub fn start_clock(&mut self, now: i64) {
        REC_T0.store(now, std::sync::atomic::Ordering::SeqCst);
        self.t0 = now;
        self.started = true;
        for t in self.system.iter().chain(self.mic.iter()) {
            t.writer.lock().unwrap().begin(now);
        }
    }

    /// Make the tracks match the switches (see the type).
    pub fn apply(&mut self, system: bool, mic: bool) {
        for (kind, on) in [(Kind::System, system), (Kind::Mic, mic)] {
            let slot_has = match kind {
                Kind::System => self.system.is_some(),
                Kind::Mic => self.mic.is_some(),
            };
            if slot_has {
                let t = if kind == Kind::System {
                    &self.system
                } else {
                    &self.mic
                };
                if let Some(t) = t {
                    t.enabled.store(on, Ordering::Relaxed);
                }
            } else if on {
                match self.make(kind) {
                    Ok(t) => {
                        if kind == Kind::System {
                            self.system = Some(t);
                        } else {
                            self.mic = Some(t);
                        }
                    }
                    Err(e) => {
                        self.notice = Some(match (kind, e) {
                            (Kind::Mic, AudioError::Denied) => "mic-denied",
                            (Kind::Mic, _) => "mic-none",
                            (Kind::System, _) => "system-none",
                        })
                    }
                }
            }
        }
    }

    fn make(&mut self, kind: Kind) -> Result<Track, AudioError> {
        let path = track_path(&self.dir, kind);
        let enabled = Arc::new(AtomicBool::new(true));
        if self.synthetic {
            let mut tw = TrackWriter::create(&path, 48_000, 2, self.t0, enabled.clone())
                .map_err(|e| AudioError::Other(e.to_string()))?;
            if !self.started {
                tw.wait_for_start();
            }
            let writer = Arc::new(std::sync::Mutex::new(tw));
            let stop = Arc::new(AtomicBool::new(false));
            let (w, s) = (writer.clone(), stop.clone());
            let hz = if kind == Kind::System { 440.0 } else { 880.0 };
            let t0 = self.t0;
            let thread = std::thread::spawn(move || {
                // A generated tone in packets of 10 ms, time stamped with the clock like a device would.
                // The tone starts now (a track made in the middle of a recording has silence before it, like a device).
                let mut frame = ((wasapi::now() - t0).max(0) * 48_000 / TICKS) as u64 / 480 * 480;
                while !s.load(Ordering::SeqCst) {
                    let ts = t0 + (frame as i64 * TICKS / 48_000);
                    let mut v = Vec::with_capacity(960);
                    for i in 0..480u64 {
                        let t = (frame + i) as f64 / 48_000.0;
                        // In a sync test the tone only sounds in the first 100 ms of every second (the camera flashes then).
                        let gate = if SYNC_TEST.load(Ordering::Relaxed) {
                            let at = t0 + ((frame + i) as i64) * TICKS / 48_000;
                            (REC_T0.load(Ordering::SeqCst) != 0 && sync_mark(recorded_ticks_at(at)))
                                as u8 as f32
                        } else {
                            1.0
                        };
                        let x = (t * hz * std::f64::consts::TAU).sin() as f32 * 0.3 * gate;
                        v.push(x);
                        v.push(x);
                    }
                    // A packet is delivered when its 10 ms are over, like a device does.
                    while wasapi::now() < ts + TICKS / 100 && !s.load(Ordering::SeqCst) {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    w.lock().unwrap().push(&v, ts);
                    frame += 480;
                }
            });
            return Ok(Track {
                writer,
                enabled,
                source: Source::Tone(stop, thread),
            });
        }
        let device = if kind == Kind::System {
            &self.system_device
        } else {
            &self.mic_device
        };
        let (capture, writer, fell_back) =
            wasapi::start(kind, device, &path, self.t0, !self.started, enabled.clone())?;
        if fell_back {
            // The chosen device is gone: the Windows default is used and the person is told.
            self.notice = Some(if kind == Kind::System {
                "system-fallback"
            } else {
                "mic-fallback"
            });
        }
        Ok(Track {
            writer,
            enabled,
            source: Source::Device(capture),
        })
    }

    fn each(&self) -> impl Iterator<Item = &Track> {
        self.system.iter().chain(self.mic.iter())
    }

    pub fn pause(&mut self) {
        let now = wasapi::now();
        for t in self.each() {
            t.writer.lock().unwrap().pause(now);
        }
    }

    pub fn resume(&mut self) {
        let now = wasapi::now();
        for t in self.each() {
            t.writer.lock().unwrap().resume(now);
        }
    }

    /// Stop the devices and close the files at the recorded time `now`; the paths of the tracks that were made.
    pub fn finish(&mut self, now: i64) -> Vec<(Kind, PathBuf)> {
        let mut out = Vec::new();
        for (kind, slot) in [
            (Kind::System, self.system.take()),
            (Kind::Mic, self.mic.take()),
        ] {
            let Some(t) = slot else { continue };
            match t.source {
                Source::Device(c) => c.stop(),
                Source::Tone(stop, thread) => {
                    stop.store(true, Ordering::SeqCst);
                    let _ = thread.join();
                }
            }
            if t.writer.lock().unwrap().finish(now).is_ok() {
                out.push((kind, track_path(&self.dir, kind)));
            }
        }
        out
    }
}

impl TrackWriter {
    pub fn channel_count(&self) -> usize {
        self.channels
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, channels: usize, from_frame: u64, frames: usize, hz: f64) -> Vec<f32> {
        let mut v = Vec::with_capacity(frames * channels);
        for i in 0..frames {
            let t = (from_frame + i as u64) as f64 / rate as f64;
            let s = (t * hz * std::f64::consts::TAU).sin() as f32 * 0.5;
            for _ in 0..channels {
                v.push(s);
            }
        }
        v
    }

    fn writer(dir: &Path) -> (TrackWriter, Arc<AtomicBool>) {
        let on = Arc::new(AtomicBool::new(true));
        (
            TrackWriter::create(&dir.join("t.wav"), 48_000, 2, 0, on.clone()).unwrap(),
            on,
        )
    }

    #[test]
    fn a_wav_file_has_the_right_header_and_length() {
        let dir = tempfile::tempdir().unwrap();
        let (mut w, _) = writer(dir.path());
        for i in 0..50 {
            w.push(&tone(48_000, 2, i * 960, 960, 440.0), i as i64 * TICKS / 50);
        }
        assert_eq!(w.finish(TICKS).unwrap(), 1000);
        let p = dir.path().join("t.wav");
        assert_eq!(wav_ms(&p), 1000);
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(bytes.len(), 44 + 48_000 * 4);
    }

    #[test]
    fn silence_is_added_when_the_device_sends_nothing_and_a_pause_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (mut w, _) = writer(dir.path());
        // A loopback device that plays nothing: only ticks. After 3 s the track is 3 s long (within the 100 ms wait).
        for ms in (0..=3000).step_by(10) {
            w.tick(ms * TICKS / 1000);
        }
        let ms = w.written_frames() * 1000 / 48_000;
        assert!((2900..=3000).contains(&ms), "{ms}");
        // Pause for 5 s: nothing is written; after the resume the clock goes on without the pause.
        w.pause(3 * TICKS);
        for ms in (3000..=8000).step_by(10) {
            w.tick(ms * TICKS / 1000);
        }
        w.resume(8 * TICKS);
        let len = w.finish(10 * TICKS).unwrap();
        assert!((4990..=5010).contains(&len), "{len}");
    }

    #[test]
    fn a_device_that_runs_fast_or_slow_is_brought_back_in_step() {
        // The device clock is 100 ppm fast and 100 ppm slow in the two runs; 10 minutes of generated tone. The track must end
        // within one video frame (33 ms) of the recorded time, and the correction (silence or drop) is what absorbed the drift.
        for ppm in [100i64, -100] {
            let dir = tempfile::tempdir().unwrap();
            let (mut w, _) = writer(dir.path());
            let rate = 48_000u64;
            let packet = 480usize; // 10 ms
            let total_packets = 60_000usize; // 10 minutes
            let mut dev_frame = 0u64;
            let mut real = 0i64;
            for _ in 0..total_packets {
                // The device produces a packet every 10 ms of ITS time; in real (clock) time that is 10 ms +/- ppm.
                let ts = real;
                w.push(&tone(rate as u32, 2, dev_frame, packet, 440.0), ts);
                dev_frame += packet as u64;
                real += (TICKS / 100) * (1_000_000 - ppm) / 1_000_000;
            }
            let end = real;
            let len = w.finish(end).unwrap() as i64;
            let wanted = end * 1000 / TICKS;
            assert!(
                (len - wanted).abs() <= 33,
                "ppm {ppm}: track {len} ms, recorded {wanted} ms"
            );
            let corrected = (w.filled + w.dropped) as f64 / rate as f64 * 1000.0;
            eprintln!(
                "drift test {ppm} ppm over 10 min: track {len} ms vs {wanted} ms; {corrected:.0} ms corrected (filled {} dropped {})",
                w.filled, w.dropped
            );
        }
    }

    #[test]
    fn a_muted_track_keeps_its_length_but_has_no_sound_and_a_cut_off_file_is_repaired() {
        let dir = tempfile::tempdir().unwrap();
        let (mut w, on) = writer(dir.path());
        on.store(false, Ordering::Relaxed);
        for i in 0..100 {
            w.push(&tone(48_000, 2, i * 960, 960, 440.0), i as i64 * TICKS / 50);
        }
        w.finish(2 * TICKS).unwrap();
        let bytes = std::fs::read(dir.path().join("t.wav")).unwrap();
        assert!(bytes[44..].iter().all(|b| *b == 0));
        // A crash: the header says less than the file holds; repair makes it right and can cut to the length of the video.
        let p = dir.path().join("t.wav");
        let mut f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.write_all(&header(48_000, 2, 0)).unwrap();
        drop(f);
        assert_eq!(wav_ms(&p), 0);
        assert_eq!(repair(&p, Some(1500)).unwrap(), 1500);
        assert_eq!(wav_ms(&p), 1500);
    }
}

#[cfg(all(test, windows))]
mod device_tests {
    /// Only the enumeration: no device is opened and nothing is recorded.
    #[test]
    fn the_device_lists_can_be_read_and_name_a_default_when_there_is_a_device() {
        let (mic, system) = super::wasapi::list_devices();
        for list in [&mic, &system] {
            assert!(list.iter().all(|d| !d.id.is_empty() && !d.name.is_empty()));
            assert!(list.iter().filter(|d| d.is_default).count() <= 1);
        }
        eprintln!("{} microphones, {} outputs", mic.len(), system.len());
    }
}
