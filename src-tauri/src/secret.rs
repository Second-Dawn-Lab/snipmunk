//! Keeping passwords out of guides. The guide recorder writes what was typed into the step; for a password it must not.
//!
//! A typing group is **secret** when, for any of its keys, the field with the keyboard focus
//! * says it is a password field (UI Automation `IsPassword`: Windows edit boxes, web pages, most toolkits), or
//! * is named like one (a "show password" button turns the field into an ordinary one; its name stays), or
//! * could not be looked at, or not soon enough after the key (the focus may have moved on meanwhile),
//!
//! or when the click just before the typing was on such a field. What is typed then is never stored: the step shows
//! `MASK` (its length says nothing), and its picture is the one from before the first key. Not recognized: a password
//! typed where no field exists to ask, such as at a terminal's prompt.

use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

/// What a secret typing step says instead of the text.
pub const MASK: &str = "••••••••";

/// An answer that comes later than this after its key is not trusted.
pub const LATE: Duration = Duration::from_millis(400);

/// Words of a field's name or id that mark it as a password field, in the interface languages.
const WORDS: [&str; 17] = [
    "password",
    "passwort",
    "passwd",
    "passcode",
    "passphrase",
    "kennwort",
    "pwd",
    "contraseña",
    "mot de passe",
    "hasło",
    "wachtwoord",
    "şifre",
    "parola",
    "密码",
    "密碼",
    "كلمة المرور",
    "پاس ورڈ",
];

/// Is a field of this name (or automation id) one for a password?
pub fn named_like_a_password(name: &str) -> bool {
    let name = name.to_lowercase();
    WORDS.iter().any(|w| name.contains(w))
}

/// Is what goes into an element with these facts to be kept out of the guide? `control` is the UI Automation control
/// type ("Edit", "Button", ...): the name counts only for text fields (a "Forgot password?" link or a document about
/// passwords is no secret field).
pub fn field_is_secret(is_password: bool, control: &str, name: &str, automation_id: &str) -> bool {
    is_password
        || (matches!(control, "Edit" | "ComboBox")
            && (named_like_a_password(name) || named_like_a_password(automation_id)))
}

/// The verdict for one key: `looked` is what the focused field said (`None`: it could not be looked at), `waited` the
/// time from the key to that answer.
pub fn verdict(looked: Option<bool>, waited: Duration) -> bool {
    waited > LATE || looked.unwrap_or(true)
}

/// A stage between the keyboard hook and the recorder, on a thread of its own so that nothing slow is ever in front of
/// it: each key that can write text is judged at once (`look`), and the event goes on with its verdict.
pub fn judge<E>(from: Receiver<E>, to: Sender<E>, mut judge_one: impl FnMut(E) -> E) {
    for event in from {
        if to.send(judge_one(event)).is_err() {
            break;
        }
    }
}

/// How long ago `at` was.
pub fn since(at: Instant) -> Duration {
    Instant::now().saturating_duration_since(at)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_password_field_is_known_by_what_it_says_or_what_it_is_called() {
        assert!(field_is_secret(true, "Edit", "", ""));
        assert!(field_is_secret(true, "Custom", "", ""));
        assert!(field_is_secret(false, "Edit", "Password", ""));
        assert!(field_is_secret(
            false,
            "Edit",
            "Neues Kennwort bestätigen",
            ""
        ));
        assert!(field_is_secret(false, "Edit", "", "login-pwd"));
        assert!(field_is_secret(false, "Edit", "Şifreniz", ""));
        assert!(field_is_secret(false, "ComboBox", "确认密码", ""));
        assert!(!field_is_secret(false, "Edit", "User name", "email"));
        assert!(!field_is_secret(false, "Edit", "Search", ""));
        // Named so, but no text field.
        assert!(!field_is_secret(false, "Hyperlink", "Forgot password?", ""));
        assert!(!field_is_secret(
            false,
            "Document",
            "Password policy.docx",
            ""
        ));
    }

    #[test]
    fn what_cannot_be_checked_in_time_is_secret() {
        let soon = Duration::from_millis(20);
        assert!(!verdict(Some(false), soon));
        assert!(verdict(Some(true), soon));
        assert!(verdict(None, soon), "the field could not be looked at");
        assert!(
            verdict(Some(false), LATE + soon),
            "the focus may have moved"
        );
    }

    #[test]
    fn every_event_goes_on_in_order_with_its_verdict() {
        let (tx, rx) = std::sync::mpsc::channel();
        let (out, got) = std::sync::mpsc::channel();
        for n in 0..5 {
            tx.send(n).unwrap();
        }
        drop(tx);
        judge(rx, out, |n| n * 10);
        assert_eq!(got.iter().collect::<Vec<_>>(), [0, 10, 20, 30, 40]);
    }
}
