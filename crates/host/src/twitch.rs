//! Twitch (WestPlay's): the real twitch.tv in a WebView of its own, hidden. The cabin page has the Twitch app (its
//! own lists and player controls); this WebView is taken where the app asks: a list of channels live (the
//! player's followed ones, or the most watched), whose cards `twitch.js` reads and tells, or a channel, whose
//! stream shows under the cabin page where the app cuts it open, alone (`twitch.js` hides the rest of Twitch's
//! site), and plays, pauses and sets its volume as asked.
//!
//! It has its own WebView2 profile (signing out of Twitch clears only Twitch's cookies). Signing in happens in
//! Twitch's own page, in a window on the desktop (signin.rs), on this WebView's profile. WestPlay learns nothing
//! of the account: only whether Twitch's page is signed in.

use std::cell::RefCell;
use std::path::Path;

use crate::signin::{self, Confirming, Progress, SignInWindow};
use crate::speakers::{self, Equalizer, Head, Speaker};
use crate::webview::{self, OffscreenWebView, PageSize, Stage};
use crate::youtube::within;

/// Where Twitch opens, and each list's page.
const HOME: &str = "https://www.twitch.tv/directory/all";
const FOLLOWING: &str = "https://www.twitch.tv/directory/following/live";

/// A list of channels live.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum List {
    /// The player's followed channels (signed in).
    Following,
    /// The most watched.
    Popular,
}

/// What the cabin page asks of Twitch (`twitch` in ui/src/shared/host.ts).
#[derive(Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Command {
    /// A list's page: its channels are told as they're read.
    Browse {
        which: List,
    },
    /// A channel's page (its login): its stream plays.
    Watch {
        channel: String,
    },
    Play,
    Pause,
    Volume {
        percent: u8,
    },
    /// Watches past Twitch's warning on a stream's content (the player chose to, in the app).
    AcceptGate,
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
    /// Show the stream at this rectangle of the frame (pixels), under the cabin page: Twitch's page at that size.
    Show {
        x: f32,
        y: f32,
        width: u32,
        height: u32,
    },
    /// Show no stream (it plays on, heard, unless paused).
    Hide,
    /// Done with Twitch: the WebView goes.
    Close,
    /// Twitch's sign-in, in a window on the desktop (or that window to the front).
    SignIn,
    /// Signs Twitch's page out.
    SignOut,
}

impl Command {
    /// Whether it's a command Twitch's page can take.
    fn is_sound(&self) -> bool {
        match self {
            Command::Watch { channel } => is_login(channel),
            Command::Volume { percent } => *percent <= 100,
            Command::Speakers { speakers } => speakers.as_deref().is_none_or(speakers::are_sound),
            Command::Head { head } => head.is_sound(),
            Command::Outside { distance, .. } => distance.is_finite() && (0.0..10_000.0).contains(distance),
            Command::Equalizer { equalizer } => equalizer.clamped() == *equalizer,
            _ => true,
        }
    }
}

/// A Twitch login: 1 to 25 letters, digits and `_`.
fn is_login(login: &str) -> bool {
    (1..=25).contains(&login.len()) && login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// An image on Twitch's own image host.
fn is_twitch_image(url: &str) -> bool {
    url.starts_with("https://static-cdn.jtvnw.net/")
}

/// `text` cut to `most` characters, without control characters.
fn plain(text: &mut String, most: usize) {
    text.retain(|c| !c.is_control());
    if let Some((at, _)) = text.char_indices().nth(most) {
        text.truncate(at);
    }
}

/// What Twitch's page says: only these fields, as read here (it's twitch.tv talking, so nothing else of it is
/// passed on).
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct State {
    /// Twitch's page has loaded (its top bar is there).
    pub loaded: bool,
    pub signed_in: bool,
    /// The channel whose page it is (`None`: a list, or another page).
    pub channel: Option<String>,
    pub name: String,
    pub title: String,
    pub game: String,
    /// Twitch's own count ("29,135").
    pub viewers: String,
    pub live: bool,
    /// Twitch's warning on the stream's content is up: the player chooses to watch past it.
    pub gate: bool,
    pub playing: bool,
    /// How loud the truck's speakers play (youtube.rs's `cab_level`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cab_level: Option<[f32; 3]>,
}

impl State {
    fn sound(mut self) -> Self {
        if self.channel.as_deref().is_some_and(|login| !is_login(login)) {
            self.channel = None;
        }
        plain(&mut self.name, 60);
        plain(&mut self.title, 200);
        plain(&mut self.game, 100);
        plain(&mut self.viewers, 20);
        self.cab_level = self
            .cab_level
            .filter(|told| told.iter().all(|v| v.is_finite()))
            .map(|[left, right, limited]| [left.clamp(0.0, 1.0), right.clamp(0.0, 1.0), limited.clamp(-60.0, 0.0)]);
        self
    }
}

/// A channel live, as a list shows it.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Card {
    pub login: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub game: String,
    #[serde(default)]
    pub viewers: String,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

/// A list's channels, as read on its page.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Channels {
    pub which: List,
    pub channels: Vec<Card>,
}

impl Channels {
    /// Only real channels, texts cut, pictures only from Twitch's image host, at most a page's worth.
    fn sound(mut self) -> Self {
        self.channels.retain(|card| is_login(&card.login));
        self.channels.truncate(60);
        for card in &mut self.channels {
            card.login.make_ascii_lowercase();
            plain(&mut card.name, 60);
            plain(&mut card.title, 200);
            plain(&mut card.game, 100);
            plain(&mut card.viewers, 20);
            for picture in [&mut card.avatar, &mut card.thumbnail] {
                if picture.as_deref().is_some_and(|url| !is_twitch_image(url)) {
                    *picture = None;
                }
            }
        }
        self
    }
}

/// What Twitch's page said, or whether the sign-in window is open.
#[derive(Debug, PartialEq)]
pub enum Report {
    State(Box<State>),
    List(Channels),
    SignInWindow(bool),
    /// The sign-in window closed signed in, and Twitch's page is yet to say it's signed in (`true`), or it has
    /// (or took too long: `false`).
    Confirming(bool),
    Spectrum(Vec<u8>),
}

/// What the page was told last of the cab (youtube.rs's).
type Told = (Option<Option<Vec<Speaker>>>, Option<Head>, Option<(bool, f32)>, Option<Equalizer>, Option<bool>);

pub struct Twitch {
    view: OffscreenWebView,
    frame: PageSize,
    outbox: RefCell<Outbox>,
    sign_in: RefCell<Option<SignInWindow>>,
    confirming: Confirming,
    pending: RefCell<Vec<Report>>,
    cab: RefCell<Told>,
    /// Where the page was taken last, to take it there again once signed in or out.
    at: RefCell<String>,
}

impl Twitch {
    /// Opens Twitch in a hidden WebView of `stage`'s frame (`width` x `height`), under the cabin page.
    pub fn start(stage: &Stage, width: u32, height: u32, user_data: &Path) -> Result<Self, webview::Error> {
        let view = OffscreenWebView::new(stage, width, height, user_data)?;
        view.log_as("twitch")?;
        view.show(false)?;
        stage.add(&view, false)?;
        view.add_startup_script(concat!(include_str!("cab_sound.js"), "\n", include_str!("twitch.js")))?;
        view.navigate(HOME)?;
        Ok(Self {
            view,
            frame: stage.page_size(),
            outbox: RefCell::new(Outbox::default()),
            sign_in: RefCell::new(None),
            confirming: Confirming::default(),
            pending: RefCell::new(Vec::new()),
            cab: RefCell::new((None, None, None, None, None)),
            at: RefCell::new(HOME.to_owned()),
        })
    }

    /// Carries out the page's command (`Close` is the caller's: [`Twitch::close`]).
    pub fn command(&self, command: &Command) -> windows::core::Result<()> {
        match command {
            command if !command.is_sound() => Ok(()),
            Command::Browse { which } => self.go(match which {
                List::Following => FOLLOWING,
                List::Popular => HOME,
            }),
            Command::Watch { channel } => self.go(&format!("https://www.twitch.tv/{}", channel.to_ascii_lowercase())),
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
                    match SignInWindow::open(self.view.environment(), &signin::TWITCH) {
                        Ok(window) => {
                            *sign_in = Some(window);
                            self.pending.borrow_mut().push(Report::SignInWindow(true));
                        }
                        Err(e) => crate::startup::mark(&format!("host: the Twitch sign-in window couldn't open: {e}")),
                    }
                }
                Ok(())
            }
            Command::SignOut => {
                self.view.delete_cookies()?;
                self.reload()
            }
            _ => self.pass(command),
        }
    }

    /// The page to `url` (a list's, or a channel's), playing as asked.
    fn go(&self, url: &str) -> windows::core::Result<()> {
        *self.at.borrow_mut() = url.to_owned();
        self.view.navigate(url)
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

    /// Passes a command on to Twitch's page (held until it's there; each page it's taken to gets what it's owed).
    fn pass(&self, command: &Command) -> windows::core::Result<()> {
        match self.outbox.borrow_mut().send(command) {
            Some(message) => self.view.post_json(&message),
            None => Ok(()),
        }
    }

    /// Twitch's page again, where it was (signed in or out since).
    pub fn reload(&self) -> windows::core::Result<()> {
        let at = self.at.borrow().clone();
        self.view.navigate(&at)
    }

    /// What Twitch's page said since the last call, oldest first, and whether the sign-in window closed.
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
            } else if let Some(report) = read_report(&message) {
                reports.push(report);
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

/// A message of Twitch's page: a list's channels (`list`), or what it says of itself.
fn read_report(message: &str) -> Option<Report> {
    let mut value: serde_json::Value = serde_json::from_str(message).ok()?;
    if let Some(list) = value.get_mut("list") {
        serde_json::from_value::<Channels>(list.take()).ok().map(|list| Report::List(list.sound()))
    } else {
        serde_json::from_value::<State>(value).ok().map(|state| Report::State(Box::new(state.sound())))
    }
}

/// The commands for Twitch's page, as JSON: held until it says it's there; each page it's taken to (every list,
/// every channel is a page of its own) gets the volume, playing or paused, and the cab's sound again.
#[derive(Default)]
struct Outbox {
    ready: bool,
    held: Vec<String>,
    playing: Option<String>,
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
            Command::Play | Command::Pause => self.playing = Some(message.clone()),
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
            [&self.volume, &self.playing, &self.speakers, &self.head, &self.outside, &self.equalizer, &self.spectrum]
                .into_iter()
                .flatten()
                .cloned()
                .collect()
        } else {
            std::mem::take(&mut self.held)
        }
    }
}

/// `{"type":"twitch","state":{...},"signingIn":…}`: what Twitch's page says (`null`: Twitch isn't running), and
/// whether its sign-in is under way.
pub fn state_message(state: Option<&State>, signing_in: bool) -> String {
    serde_json::json!({ "type": "twitch", "state": state, "signingIn": signing_in }).to_string()
}

/// `{"type":"twitchList","which":…,"channels":[…]}`: a list's channels live.
pub fn list_message(list: &Channels) -> String {
    let mut message = serde_json::to_value(list).expect("lists serialise");
    message["type"] = "twitchList".into();
    message.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_pages_commands() {
        let read = |text: &str| serde_json::from_str::<Command>(text).ok();
        assert_eq!(
            read(r#"{"action":"browse","which":"following"}"#),
            Some(Command::Browse { which: List::Following })
        );
        assert_eq!(
            read(r#"{"action":"watch","channel":"squeezie"}"#),
            Some(Command::Watch { channel: "squeezie".into() })
        );
        assert_eq!(read(r#"{"action":"acceptGate"}"#), Some(Command::AcceptGate));
        assert_eq!(read(r#"{"action":"explode"}"#), None);
    }

    #[test]
    fn watches_only_a_channel() {
        assert!(Command::Watch { channel: "Squeezie_42".into() }.is_sound());
        assert!(!Command::Watch { channel: "../settings".into() }.is_sound());
        assert!(!Command::Watch { channel: "squeezie?x=1".into() }.is_sound());
        assert!(!Command::Watch { channel: String::new() }.is_sound());
        assert!(!Command::Watch { channel: "a".repeat(26) }.is_sound());
    }

    #[test]
    fn passes_on_only_real_channels_and_twitchs_pictures() {
        let message = r#"{"list":{"which":"popular","channels":[
            {"login":"Squeezie","name":"Squeezie","title":"GENTLE MATES vs MIBR","game":"VALORANT","viewers":"17.6K viewers",
             "avatar":"https://static-cdn.jtvnw.net/jtv_user_pictures/a.png","thumbnail":"https://evil.example/t.jpg","extra":1},
            {"login":"../x","name":"Nope"}
        ]}}"#;
        let Some(Report::List(list)) = read_report(message) else { panic!("a list") };
        assert_eq!(list.which, List::Popular);
        assert_eq!(list.channels.len(), 1);
        assert_eq!(list.channels[0].login, "squeezie");
        assert!(list.channels[0].avatar.is_some());
        assert_eq!(list.channels[0].thumbnail, None);
        assert!(list_message(&list).contains(r#""type":"twitchList""#));
        let state =
            r#"{"loaded":true,"signedIn":false,"channel":"squeezie","name":"Squeezie","live":true,"playing":true}"#;
        assert!(matches!(read_report(state), Some(Report::State(_))));
    }

    #[test]
    fn gives_each_page_the_volume_and_playing_again() {
        let mut outbox = Outbox::default();
        assert_eq!(outbox.send(&Command::Volume { percent: 40 }), None);
        assert_eq!(outbox.ready(), [r#"{"action":"volume","percent":40}"#]);
        assert!(outbox.send(&Command::Pause).is_some());
        assert_eq!(outbox.ready(), [r#"{"action":"volume","percent":40}"#, r#"{"action":"pause"}"#]);
    }
}
