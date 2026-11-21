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

/// Join the segments (in this order) into `out`. All segments must have the same picture size and parameter sets (they are made
/// by encoders with the same settings). A single segment is copied as it is.
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
            timescale: 1000,
        },
    )
    .map_err(|e| e.to_string())?;
    writer
        .add_track(&TrackConfig {
            track_type: TrackType::Video,
            timescale: 1000,
            language: "und".into(),
            media_conf: MediaConfig::AvcConfig(config.clone()),
        })
        .map_err(|e| e.to_string())?;

    let mut offset_ms: u64 = 0;
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
        let mut end_ms = 0u64;
        // A segment starts at its first sample, whatever the clock of the capture said when it began.
        let base = match r.read_sample(tid, 1).map_err(|e| e.to_string())? {
            Some(first) => first.start_time * 1000 / scale,
            None => 0,
        };
        for n in 1..=count {
            let Some(s) = r.read_sample(tid, n).map_err(|e| e.to_string())? else {
                continue;
            };
            let start = (s.start_time * 1000 / scale).saturating_sub(base);
            let dur = ((s.duration as u64 * 1000 / scale).max(1)) as u32;
            let off = (s.rendering_offset as i64 * 1000 / scale as i64) as i32;
            end_ms = end_ms.max(start + dur as u64);
            writer
                .write_sample(
                    1,
                    &Mp4Sample {
                        start_time: offset_ms + start,
                        duration: dur,
                        rendering_offset: off,
                        is_sync: s.is_sync,
                        bytes: s.bytes,
                    },
                )
                .map_err(|e| e.to_string())?;
            samples += 1;
        }
        offset_ms += end_ms;
    }
    writer.write_end().map_err(|e| e.to_string())?;
    drop(writer);
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())?;
    Ok(Joined {
        segments: segments.len(),
        samples,
        duration_ms: offset_ms,
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
        let dir = tempfile::tempdir().unwrap();
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
    fn a_file_that_is_not_an_mp4_is_not_readable_and_nothing_joins_without_segments() {
        let dir = tempfile::tempdir().unwrap();
        let junk = dir.path().join("screen-000.mp4");
        std::fs::write(&junk, b"not an mp4 at all").unwrap();
        assert!(readable(&[junk]).is_empty());
        assert!(join(&[], &dir.path().join("out.mp4")).is_err());
    }
}
