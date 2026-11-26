//! Where the tests write. Each test makes a folder of its own, which is deleted when its guard is dropped: also when
//! the test fails, since the guard is dropped while the panic unwinds. On a developer's PC nothing of a test goes into
//! the system's temp folder or into Snipmunk's own folders.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tempfile::TempDir;

/// The folder the test folders are made in: `SNIPMUNK_TEST_DIR`, else `SNIPMUNK_TEMP_DIR`, else `_scratch\tmp` beside
/// the repository where there is a `_scratch` folder, else the system's temp folder (the build servers).
pub fn base() -> &'static Path {
    static BASE: OnceLock<PathBuf> = OnceLock::new();
    BASE.get_or_init(|| {
        let set = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty());
        let dir = set("SNIPMUNK_TEST_DIR")
            .or_else(|| set("SNIPMUNK_TEMP_DIR"))
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                // (two up from this crate: the folder that holds the repository)
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .ancestors()
                    .nth(2)
                    .map(|above| above.join("_scratch"))
                    .filter(|scratch| scratch.is_dir())
                    .map_or_else(std::env::temp_dir, |scratch| scratch.join("tmp"))
            });
        let dir = std::path::absolute(&dir).unwrap_or(dir);
        std::fs::create_dir_all(&dir).expect("the folder for the test folders");
        dir
    })
}

/// A new empty folder for one test, deleted with the guard.
pub fn new() -> TempDir {
    tempfile::Builder::new()
        .prefix("snipmunk-test-")
        .tempdir_in(base())
        .expect("a test folder")
}

thread_local! {
    static PRODUCT: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// While this lives, the folders Snipmunk itself writes to are inside a test folder (for this test's thread).
pub struct ProductFolders {
    // (dropped after `Drop::drop`, which takes the folder out of use first)
    _dir: TempDir,
}

impl Drop for ProductFolders {
    fn drop(&mut self) {
        PRODUCT.with_borrow_mut(|p| *p = None);
    }
}

/// Moves Snipmunk's own folders into a new test folder. A test that reaches one of them calls this first.
pub fn product_folders() -> ProductFolders {
    let dir = new();
    PRODUCT.with_borrow_mut(|p| *p = Some(dir.path().to_path_buf()));
    ProductFolders { _dir: dir }
}

/// The test's stand-in for one of Snipmunk's folders. Fails the test that did not ask for one, so that no test writes
/// into the real folder by accident.
pub fn product_folder(name: &str) -> PathBuf {
    PRODUCT
        .with_borrow(|p| p.as_ref().map(|dir| dir.join(name)))
        .expect(
            "call testdir::product_folders() first: tests do not write into Snipmunk's own folders",
        )
}
