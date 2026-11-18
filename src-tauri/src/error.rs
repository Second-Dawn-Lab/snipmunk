//! The error every command returns to the web page: a stable `code` to branch on and a `message` to show.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CmdError {
    pub code: String,
    pub message: String,
}

impl CmdError {
    pub fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}

impl From<std::io::Error> for CmdError {
    fn from(e: std::io::Error) -> Self {
        Self::new("io", e)
    }
}

impl From<serde_json::Error> for CmdError {
    fn from(e: serde_json::Error) -> Self {
        Self::new("bad_request", e)
    }
}

pub type CmdResult<T> = Result<T, CmdError>;
