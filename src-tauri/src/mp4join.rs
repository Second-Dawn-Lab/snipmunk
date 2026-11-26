//! Joining the segments of a recording into one MP4 without re-encoding (a remux): every sample (an H.264 access unit) is read
//! out of its segment and written into the new file with its time moved behind the samples of the segments before it. The
//! `mp4` crate (MIT) reads and writes the boxes.
//!
//! The segments exist so that a crash or a power cut loses at most the last few seconds: a segment is a finished, readable MP4
//! as soon as its encoder is finished; only the segment being written when the program dies is lost.

use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

use mp4::{
    AvcConfig, FourCC, MediaConfig, Mp4Config, Mp4Reader, Mp4Sample, Mp4Writer, TrackConfig,
    TrackType,
};

/// What a join made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Joined {
    pub segments: usize,
    pub samples: u64,
    /// The length of the joined video in milliseconds.
    pub duration_ms: u64,
}

fn video_track(r: &Mp4Reader<BufReader<File>>) -> Result<u32, String> {
    r.tracks()
        .iter()
        .find(|(_, t)| t.track_type().ok() == Some(TrackType::Video))
        .map(|(id, _)| *id)
        .ok_or_else(|| "the segment has no video".to_string())
}

fn open(path: &Path) -> Result<Mp4Reader<BufReader<File>>, String> {
    let f = File::open(path).map_err(|e| e.to_string())?;
    let size = f.metadata().map_err(|e| e.to_string())?.len();
    Mp4Reader::read_header(BufReader::new(f), size).map_err(|e| format!("{}: {e}", path.display()))
}

/// Segments that can be read (an unfinished segment, the one a crash cut off, has no `moov` box and is left out), in order.
pub fn readable(segments: &[PathBuf]) -> Vec<PathBuf> {
    segments
        .iter()
        .filter(|p| open(p).is_ok())
        .cloned()
        .collect()
}

/// The finest clock of a joined file (ticks a second); the video encoder uses 30,000 or 60,000.
const MAX_TIMESCALE: u64 = 90_000;

/// `value` ticks of a clock with `from` ticks a second, in ticks of `to`, to the nearest one.
fn rescale(value: i64, from: u64, to: u64) -> i64 {
    let (value, from, to) = (value as i128, from.max(1) as i128, to as i128);
    ((value * to * 2 + from).div_euclid(from * 2)) as i64
}

/// Join the segments (in this order) into `out`. All segments must have the same picture size and parameter sets (they are made
/// by encoders with the same settings). A single segment is copied as it is.
///
/// The joined file keeps the clock of the first segment, so every picture stays exactly where it was: the cursor, the clicks and
/// the sound are placed by the time of a picture. (Whole milliseconds are too coarse: a picture at 30 a second would lose a third
/// of one, a second of video 10 ms, ten minutes 6 s.)
pub fn join(segments: &[PathBuf], out: &Path) -> Result<Joined, String> {
    let first = segments.first().ok_or("there is nothing to join")?;
    if segments.len() == 1 {
        std::fs::copy(first, out).map_err(|e| e.to_string())?;
        let r = open(first)?;
        let id = video_track(&r)?;
        return Ok(Joined {
            segments: 1,
            samples: r.sample_count(id).unwrap_or(0) as u64,
            duration_ms: r.duration().as_millis() as u64,
        });
    }
    let head = open(first)?;
    let id = video_track(&head)?;
    let track = &head.tracks()[&id];
    let clock = (track.timescale() as u64).clamp(1000, MAX_TIMESCALE);
    let config = AvcConfig {
        width: track.width(),
        height: track.height(),
        seq_param_set: track
            .sequence_parameter_set()
            .map_err(|e| e.to_string())?
            .to_vec(),
        pic_param_set: track
            .picture_parameter_set()
            .map_err(|e| e.to_string())?
            .to_vec(),
    };
    drop(head);
    let tmp = out.with_extension("mp4.part");
    let file = File::create(&tmp).map_err(|e| e.to_string())?;
    let mut writer = Mp4Writer::write_start(
        BufWriter::new(file),
        &Mp4Config {
            major_brand: FourCC::from(*b"isom"),
            minor_version: 512,
            compatible_brands: vec![
                FourCC::from(*b"isom"),
                FourCC::from(*b"iso2"),
                FourCC::from(*b"avc1"),
                FourCC::from(*b"mp41"),
            ],
            // The same clock for the file and the track: the library then sums the track's length without rounding.
            timescale: clock as u32,
        },
    )
    .map_err(|e| e.to_string())?;
    writer
        .add_track(&TrackConfig {
            track_type: TrackType::Video,
            timescale: clock as u32,
            language: "und".into(),
            media_conf: MediaConfig::AvcConfig(config.clone()),
        })
        .map_err(|e| e.to_string())?;

    // Where the next segment begins, in ticks of `clock`.
    let mut offset: u64 = 0;
    let mut samples = 0u64;
    for path in segments {
        let mut r = open(path)?;
        let tid = video_track(&r)?;
        let t = &r.tracks()[&tid];
        if t.width() != config.width
            || t.height() != config.height
            || t.sequence_parameter_set().map_err(|e| e.to_string())?
                != config.seq_param_set.as_slice()
            || t.picture_parameter_set().map_err(|e| e.to_string())?
                != config.pic_param_set.as_slice()
        {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "{} has other video settings than the first segment",
                path.display()
            ));
        }
        let scale = t.timescale().max(1) as u64;
        let count = r.sample_count(tid).map_err(|e| e.to_string())?;
        let mut length = 0u64;
        // A segment starts at its first sample, whatever the clock of the capture said when it began.
        let base = match r.read_sample(tid, 1).map_err(|e| e.to_string())? {
            Some(first) => first.start_time,
            None => 0,
        };
        for n in 1..=count {
            let Some(s) = r.read_sample(tid, n).map_err(|e| e.to_string())? else {
                continue;
            };
            // Both ends are converted, not the duration: so no rounding adds up from picture to picture.
            let begins = s.start_time.saturating_sub(base);
            let start = rescale(begins as i64, scale, clock) as u64;
            let end = rescale((begins + s.duration as u64) as i64, scale, clock) as u64;
            let dur = end.saturating_sub(start).max(1) as u32;
            let off = rescale(s.rendering_offset as i64, scale, clock) as i32;
            length = length.max(start + dur as u64);
            writer
                .write_sample(
                    1,
                    &Mp4Sample {
                        start_time: offset + start,
                        duration: dur,
                        rendering_offset: off,
                        is_sync: s.is_sync,
                        bytes: s.bytes,
                    },
                )
                .map_err(|e| e.to_string())?;
            samples += 1;
        }
        offset += length;
    }
    writer.write_end().map_err(|e| e.to_string())?;
    drop(writer);
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())?;
    Ok(Joined {
        segments: segments.len(),
        samples,
        duration_ms: rescale(offset as i64, clock, 1000) as u64,
    })
}

/// The segment files of a recording folder (`screen-000.mp4`, `screen-001.mp4`, ...), in order.
pub fn segments_in(dir: &Path) -> Vec<PathBuf> {
    segments_named(dir, "screen")
}

/// The segment files `<prefix>-000.mp4`, ... of a folder, in order.
pub fn segments_named(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let start = format!("{prefix}-");
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with(&start) && n.ends_with(".mp4"))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_segment_files_of_a_folder_are_found_in_order_and_other_files_are_not() {
        let dir = crate::testdir::new();
        for n in [
            "screen-002.mp4",
            "screen-000.mp4",
            "screen-001.mp4",
            "screen.mp4",
            "first.png",
            "screen-001.mp4.part",
        ] {
            std::fs::write(dir.path().join(n), b"x").unwrap();
        }
        let names: Vec<String> = segments_in(dir.path())
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            ["screen-000.mp4", "screen-001.mp4", "screen-002.mp4"]
        );
    }

    #[test]
    fn times_are_converted_to_the_nearest_tick_so_nothing_adds_up() {
        // A picture at 30 a second on a clock of 30,000: 33.333... ms. Ten minutes of them stay ten minutes.
        assert_eq!(rescale(1000, 30_000, 30_000), 1000);
        assert_eq!(rescale(18_000 * 1000, 30_000, 1000), 600_000);
        assert_eq!(rescale(1000, 30_000, 1000), 33);
        assert_eq!(rescale(2000, 30_000, 1000), 67);
        // A finer clock than the joined file's (100 ns): both ends of a picture are converted, so the lengths add up.
        let end = |n: i64| rescale(n * 333_333, 10_000_000, MAX_TIMESCALE);
        let total: i64 = (0..900).map(|n| end(n + 1) - end(n)).sum();
        assert_eq!(total, end(900));
        assert_eq!(rescale(-1000, 30_000, 30_000), -1000);
    }

    #[test]
    fn a_file_that_is_not_an_mp4_is_not_readable_and_nothing_joins_without_segments() {
        let dir = crate::testdir::new();
        let junk = dir.path().join("screen-000.mp4");
        std::fs::write(&junk, b"not an mp4 at all").unwrap();
        assert!(readable(&[junk]).is_empty());
        assert!(join(&[], &dir.path().join("out.mp4")).is_err());
    }
}
