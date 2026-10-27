//! TikTok (WestPlay's): the real tiktok.com in a WebView of its own, hidden, as the engine that plays the For You
//! feed. The player never sees TikTok's page: the cabin page has the TikTok app (its own controls and texts); this
//! WebView's picture shows under the cabin page where the video goes, with all of TikTok's page hidden but the
//! video playing (`tiktok.js`, run before tiktok.com's own scripts), and it plays, pauses, goes to the next video
//! and back and likes as the page asks, telling the page what plays.
//!
//! It has its own WebView2 profile (signing out of TikTok clears only TikTok's cookies). TikTok's feed asks a
//! player not signed in to sign in after a video or two, so the app asks for it first: TikTok's own sign-in page,
//! in a window on the desktop (signin.rs), on this WebView's profile. WestPlay learns nothing of the account:
//! only whether TikTok's page is signed in.

use std::cell::RefCell;
use std::path::Path;

use crate::signin::{self, Confirming, Progress, SignInWindow};
use crate::speakers::{self, Equalizer, Head, Speaker};
use crate::webview::{self, OffscreenWebView, PageSize, Stage};
use crate::youtube::within;

/// Where TikTok opens: its For You feed.
const HOME: &str = "https://www.tiktok.com/foryou";

/// What the cabin page asks of TikTok (`tiktok` in ui/src/shared/host.ts).
#[derive(Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Command {
    Play,
    Pause,
    /// The feed's next video, or the one before.
    Next,
    Previous,
    /// Likes the video playing, or takes the like back (TikTok's own button).
    Like,
    Volume {
        percent: u8,
    },
    /// The truck's own speakers, the driver's head, the camera outside the cab, the tone and the spectrum, as
    /// YouTube's (youtube.rs). The host's own.
    Speakers {
        speakers: Option<Vec<Speaker>>,
    },
    Head {
        #[serde(flatten)]
        head: Head,
    },
    Outside {
        on: bool,
        #[serde(default)]
        distance: f32,
    },
    Equalizer {
        #[serde(flatten)]
        equalizer: Equalizer,
    },
    Spectrum {
        on: bool,
    },
    /// Show the video at this rectangle of the frame (pixels), under the cabin page: TikTok's page at that size.
    Show {
        x: f32,
        y: f32,
        width: u32,
        height: u32,
    },
    /// Show no video (it plays on, heard, unless paused).
    Hide,
    /// Done with TikTok: the WebView goes.
    Close,
    /// TikTok's sign-in, in a window on the desktop (or that window to the front).
    SignIn,
    /// Signs TikTok's page out.
    SignOut,
}

impl Command {
    /// Whether it's a command TikTok's page can take.
    fn is_sound(&self) -> bool {
        match self {
            Command::Volume { percent } => *percent <= 100,
            Command::Speakers { speakers } => speakers.as_deref().is_none_or(speakers::are_sound),
            Command::Head { head } => head.is_sound(),
            Command::Outside { distance, .. } => distance.is_finite() && (0.0..10_000.0).contains(distance),
            Command::Equalizer { equalizer } => equalizer.clamped() == *equalizer,
            _ => true,
        }
    }
}

/// What TikTok's page says plays: only these fields, as read here (it's tiktok.com's page talking, so nothing
/// else of it is passed on).
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct State {
    /// TikTok's page has its feed, or its sign-in button: it has loaded.
    pub loaded: bool,
    pub signed_in: bool,
    /// The video's id (TikTok's: digits).
    pub video: Option<String>,
    pub author: String,
    pub handle: String,
    pub avatar: Option<String>,
    pub description: String,
    pub music: String,
    /// TikTok's own counts ("12.3K").
    pub likes: String,
    pub comments: String,
    /// Whether the player liked it (`None`: not known).
    pub liked: Option<bool>,
    pub playing: bool,
    pub time: f64,
    pub duration: f64,
    /// How loud the truck's speakers play (youtube.rs's `cab_level`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cab_level: Option<[f32; 3]>,
}

impl State {
    /// The state with only what can be shown: a real id, texts cut, pictures only from TikTok's image hosts.
    fn sound(mut self) -> Self {
        if self.video.as_deref().is_some_and(|id| !is_video_id(id)) {
            self.video = None;
        }
        cut(&mut self.author, 100);
        self.handle.retain(|c| c.is_alphanumeric() || c == '_' || c == '.');
        cut(&mut self.handle, 60);
        self.description.retain(|c| !c.is_control());
        cut(&mut self.description, 400);
        cut(&mut self.music, 150);
        cut(&mut self.likes, 20);
        cut(&mut self.comments, 20);
        if self.avatar.as_deref().is_some_and(|url| !is_tiktok_image(url)) {
            self.avatar = None;
        }
        if !self.time.is_finite() {
            self.time = 0.0;
        }
        if !self.duration.is_finite() {
            self.duration = 0.0;
        }
        self.cab_level = self
            .cab_level
            .filter(|told| told.iter().all(|v| v.is_finite()))
            .map(|[left, right, limited]| [left.clamp(0.0, 1.0), right.clamp(0.0, 1.0), limited.clamp(-60.0, 0.0)]);
        self
    }
}

/// `text` cut to `most` characters.
fn cut(text: &mut String, most: usize) {
    if let Some((at, _)) = text.char_indices().nth(most) {
        text.truncate(at);
    }
}

/// A TikTok video id: digits, of a sensible length.
fn is_video_id(id: &str) -> bool {
    (6..=25).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

/// An image on TikTok's own image hosts (`p16-sign-va.tiktokcdn.com`, `….tiktokcdn-eu.com`).
fn is_tiktok_image(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let Some(name) = host.rsplit_once(".tiktokcdn").map(|(_, after)| after) else { return false };
    let mut labels = host.split('.');
    labels.all(|label| !label.is_empty() && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        && (name == ".com"
            || name
                .strip_prefix('-')
                .and_then(|n| n.strip_suffix(".com"))
                .is_some_and(|region| !region.is_empty() && region.bytes().all(|b| b.is_ascii_lowercase())))
}

/// What TikTok's page said, or whether the sign-in window is open.
#[derive(Debug, PartialEq)]
pub enum Report {
    State(Box<State>),
    SignInWindow(bool),
    /// The sign-in window closed signed in, and TikTok's page is yet to say it's signed in (`true`), or it has
    /// (or took too long: `false`).
    Confirming(bool),
    Spectrum(Vec<u8>),
}

/// What the page was told last of the cab (youtube.rs's).
type Told = (Option<Option<Vec<Speaker>>>, Option<Head>, Option<(bool, f32)>, Option<Equalizer>, Option<bool>);

pub struct TikTok {
    view: OffscreenWebView,
    frame: PageSize,
    outbox: RefCell<Outbox>,
    sign_in: RefCell<Option<SignInWindow>>,
    confirming: Confirming,
    pending: RefCell<Vec<Report>>,
    cab: RefCell<Told>,
}

impl TikTok {
    /// Opens TikTok in a hidden WebView of `stage`'s frame (`width` x `height`), under the cabin page.
    pub fn start(stage: &Stage, width: u32, height: u32, user_data: &Path) -> Result<Self, webview::Error> {
        let view = OffscreenWebView::new(stage, width, height, user_data)?;
        view.log_as("tiktok")?;
        view.show(false)?;
        stage.add(&view, false)?;
        view.add_startup_script(concat!(include_str!("cab_sound.js"), "\n", include_str!("tiktok.js")))?;
        view.navigate(HOME)?;
        Ok(Self {
            view,
            frame: stage.page_size(),
            outbox: RefCell::new(Outbox::default()),
            sign_in: RefCell::new(None),
            confirming: Confirming::default(),
            pending: RefCell::new(Vec::new()),
            cab: RefCell::new((None, None, None, None, None)),
        })
    }

    /// Carries out the page's command (`Close` is the caller's: [`TikTok::close`]).
    pub fn command(&self, command: &Command) -> windows::core::Result<()> {
        match command {
            Command::Show { x, y, width, height } => {
                let (x, y, width, height) = within(self.frame.get(), *x, *y, *width, *height);
                self.view.place(x, y, width, height)?;
                self.view.show(true)
            }
            Command::Hide => self.view.show(false),
            Command::Close => Ok(()),
            Command::SignIn => {
                let mut sign_in = self.sign_in.borrow_mut();
                if let Some(window) = sign_in.as_ref() {
                    window.bring_forward();
                } else {
                    match SignInWindow::open(self.view.environment(), &signin::TIKTOK) {
                        Ok(window) => {
                            *sign_in = Some(window);
                            self.pending.borrow_mut().push(Report::SignInWindow(true));
                        }
                        Err(e) => crate::startup::mark(&format!("host: the TikTok sign-in window couldn't open: {e}")),
                    }
                }
                Ok(())
            }
            Command::SignOut => {
                self.view.delete_cookies()?;
                self.reload()
            }
            command if !command.is_sound() => Ok(()),
            _ => self.pass(command),
        }
    }

    /// The truck's speakers, the driver's head, the camera, the tone and the spectrum, as YouTube's
    /// ([`crate::youtube::YouTube::cab`]).
    pub fn cab(
        &self,
        speakers: Option<&[Speaker]>,
        head: Head,
        outside: bool,
        distance: f32,
        equalizer: Equalizer,
        spectrum: bool,
    ) -> windows::core::Result<()> {
        let mut cab = self.cab.borrow_mut();
        if cab.1 != Some(head) && head.is_sound() {
            cab.1 = Some(head);
            self.pass(&Command::Head { head })?;
        }
        if cab.0.as_ref().map(Option::as_deref) != Some(speakers) {
            let speakers = speakers.map(<[_]>::to_vec);
            cab.0 = Some(speakers.clone());
            self.pass(&Command::Speakers { speakers })?;
        }
        let camera = (outside, if outside { (distance * 4.0).round() / 4.0 } else { 0.0 });
        if cab.2 != Some(camera) {
            cab.2 = Some(camera);
            self.pass(&Command::Outside { on: camera.0, distance: camera.1 })?;
        }
        if cab.3 != Some(equalizer) {
            cab.3 = Some(equalizer);
            self.pass(&Command::Equalizer { equalizer })?;
        }
        if cab.4 != Some(spectrum) {
            cab.4 = Some(spectrum);
            self.pass(&Command::Spectrum { on: spectrum })?;
        }
        Ok(())
    }

    /// Passes a command on to TikTok's page (held until it's there).
    fn pass(&self, command: &Command) -> windows::core::Result<()> {
        match self.outbox.borrow_mut().send(command) {
            Some(message) => self.view.post_json(&message),
            None => Ok(()),
        }
    }

    /// TikTok's page again, from its feed (signed in or out since).
    pub fn reload(&self) -> windows::core::Result<()> {
        self.view.navigate(HOME)
    }

    /// What TikTok's page said since the last call, oldest first, and whether the sign-in window closed.
    pub fn take_reports(&self) -> Vec<Report> {
        let mut reports = std::mem::take(&mut *self.pending.borrow_mut());
        let progress = self.sign_in.borrow().as_ref().map(SignInWindow::progress);
        if let Some(progress @ (Progress::SignedIn | Progress::Closed)) = progress {
            self.sign_in.borrow_mut().take();
            reports.push(Report::SignInWindow(false));
            if progress == Progress::SignedIn {
                let _ = self.reload();
                self.confirming.start();
                reports.push(Report::Confirming(true));
            }
        }
        for message in self.view.take_page_messages() {
            if message == r#"{"ready":true}"# {
                for owed in self.outbox.borrow_mut().ready() {
                    let _ = self.view.post_json(&owed);
                }
            } else if let Some(bars) = speakers::read_spectrum(&message) {
                reports.push(Report::Spectrum(bars));
            } else if let Ok(state) = serde_json::from_str::<State>(&message) {
                reports.push(Report::State(Box::new(state.sound())));
            }
        }
        let signed_in = reports.iter().rev().find_map(|report| match report {
            Report::State(state) if state.loaded => Some(state.signed_in),
            _ => None,
        });
        if self.confirming.ended(signed_in) {
            reports.push(Report::Confirming(false));
        }
        reports
    }

    /// Whether the WebView failed since the last call (it's then closed and started again when needed).
    pub fn failed(&self) -> bool {
        self.view.take_failure().is_some()
    }

    /// Takes the WebView off the frame; it closes as it's dropped.
    pub fn close(self, stage: &Stage) {
        let _ = stage.remove(&self.view);
    }
}

/// The commands for TikTok's page, as JSON: held until it says it's there; a page that loads again gets the
/// volume and the cab's sound again.
#[derive(Default)]
struct Outbox {
    ready: bool,
    held: Vec<String>,
    volume: Option<String>,
    speakers: Option<String>,
    head: Option<String>,
    outside: Option<String>,
    equalizer: Option<String>,
    spectrum: Option<String>,
}

impl Outbox {
    /// `command` as the message to post now, or `None`: held until the page is there.
    fn send(&mut self, command: &Command) -> Option<String> {
        let message = serde_json::to_string(command).expect("commands serialise");
        match command {
            Command::Volume { .. } => self.volume = Some(message.clone()),
            Command::Speakers { .. } => self.speakers = Some(message.clone()),
            Command::Head { .. } => self.head = Some(message.clone()),
            Command::Outside { .. } => self.outside = Some(message.clone()),
            Command::Equalizer { .. } => self.equalizer = Some(message.clone()),
            Command::Spectrum { .. } => self.spectrum = Some(message.clone()),
            _ => {}
        }
        if self.ready {
            Some(message)
        } else {
            self.held.push(message);
            None
        }
    }

    /// The page says it's there: what to post to it (the first time, what was held; after, what it's owed).
    fn ready(&mut self) -> Vec<String> {
        if std::mem::replace(&mut self.ready, true) {
            [&self.volume, &self.speakers, &self.head, &self.outside, &self.equalizer, &self.spectrum]
                .into_iter()
                .flatten()
                .cloned()
                .collect()
        } else {
            std::mem::take(&mut self.held)
        }
    }
}

/// `{"type":"tiktok","state":{...},"signingIn":…}`: what TikTok plays (`null`: TikTok isn't running), and whether
/// its sign-in is under way.
pub fn state_message(state: Option<&State>, signing_in: bool) -> String {
    serde_json::json!({ "type": "tiktok", "state": state, "signingIn": signing_in }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_pages_commands() {
        let read = |text: &str| serde_json::from_str::<Command>(text).ok();
        assert_eq!(read(r#"{"action":"next"}"#), Some(Command::Next));
        assert_eq!(read(r#"{"action":"volume","percent":40}"#), Some(Command::Volume { percent: 40 }));
        assert_eq!(
            read(r#"{"action":"show","x":0,"y":0,"width":1280,"height":720}"#),
            Some(Command::Show { x: 0.0, y: 0.0, width: 1280, height: 720 })
        );
        assert_eq!(read(r#"{"action":"explode"}"#), None);
        assert!(!Command::Volume { percent: 101 }.is_sound());
    }

    #[test]
    fn passes_on_only_what_can_be_shown() {
        let message = r#"{"loaded":true,"signedIn":true,"video":"7690999327220567316","author":"ECOVACS France",
            "handle":"ecovacs_france\"><img","avatar":"https://p16-common-sign.tiktokcdn-eu.com/a.jpg",
            "description":"Created for Ease.","music":"son original","likes":"2439","comments":"18","liked":false,
            "playing":true,"time":1.5,"duration":6.6,"extra":"x"}"#;
        let state = serde_json::from_str::<State>(message).unwrap().sound();
        assert_eq!(state.video.as_deref(), Some("7690999327220567316"));
        assert_eq!(state.handle, "ecovacs_franceimg");
        assert!(state.avatar.is_some());
        let bad = r#"{"video":"1;alert(1)","avatar":"https://evil.example/?.tiktokcdn.com/a.jpg"}"#;
        let state = serde_json::from_str::<State>(bad).unwrap().sound();
        assert_eq!((state.video, state.avatar), (None, None));
    }

    #[test]
    fn takes_pictures_only_from_tiktoks_image_hosts() {
        assert!(is_tiktok_image("https://p16-sign-va.tiktokcdn.com/x.jpeg?a=1"));
        assert!(is_tiktok_image("https://p16-common-sign.tiktokcdn-eu.com/tos/x.jpg"));
        assert!(!is_tiktok_image("http://p16-sign-va.tiktokcdn.com/x.jpeg"));
        assert!(!is_tiktok_image("https://tiktokcdn.com.evil.example/x.jpeg"));
        assert!(!is_tiktok_image("https://evil.example/p16.tiktokcdn.com/x.jpeg"));
    }

    #[test]
    fn gives_a_reloaded_page_its_volume_again() {
        let mut outbox = Outbox::default();
        assert_eq!(outbox.send(&Command::Volume { percent: 40 }), None);
        assert_eq!(outbox.send(&Command::Next), None);
        assert_eq!(outbox.ready(), [r#"{"action":"volume","percent":40}"#, r#"{"action":"next"}"#]);
        assert!(outbox.send(&Command::Play).is_some());
        assert_eq!(outbox.ready(), [r#"{"action":"volume","percent":40}"#]);
    }
}
