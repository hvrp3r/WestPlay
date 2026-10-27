//! X (formerly Twitter; WestPlay's): the real x.com in a WebView of its own, hidden. The cabin page has the X app
//! (its own timeline and player controls); this WebView is on the player's timeline (x.com/home), whose posts
//! `twitter.js` reads and tells, scrolling on for more as asked, or on a post's own page, whose video shows under
//! the cabin page where the app cuts it open, alone, and plays, pauses and sets its volume as asked.
//!
//! It has its own WebView2 profile (signing out of X clears only X's cookies). X shows nothing to a page not
//! signed in, so the app asks for the sign-in first: X's own page, in a window on the desktop (signin.rs), on this
//! WebView's profile. WestPlay learns nothing of the account: only whether X's page is signed in.

use std::cell::RefCell;
use std::path::Path;

use crate::signin::{self, Confirming, Progress, SignInWindow};
use crate::speakers::{self, Equalizer, Head, Speaker};
use crate::webview::{self, OffscreenWebView, PageSize, Stage};
use crate::youtube::within;

/// The player's timeline.
const HOME: &str = "https://x.com/home";

/// A timeline: X's For you, or the accounts the player follows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Feed {
    ForYou,
    Following,
}

/// What the cabin page asks of X (`twitter` in ui/src/shared/host.ts).
#[derive(Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Command {
    /// The timeline's page again (from a post's), its posts told anew.
    Home,
    /// For you, or Following (X's own tabs).
    Feed {
        which: Feed,
    },
    /// More of the timeline: X's page scrolled on.
    More,
    /// Likes a post on the timeline (its id), or takes the like back.
    Like {
        id: String,
    },
    /// A post's own page (its id): its video plays.
    Watch {
        id: String,
    },
    /// A post's own page (its id): its conversation is told (the posts it answers, it, the replies to it).
    Thread {
        id: String,
    },
    Play,
    Pause,
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
    /// Show the video at this rectangle of the frame (pixels), under the cabin page: X's page at that size.
    Show {
        x: f32,
        y: f32,
        width: u32,
        height: u32,
    },
    /// Show no video (it plays on, heard, unless paused).
    Hide,
    /// Done with X: the WebView goes.
    Close,
    /// X's sign-in, in a window on the desktop (or that window to the front).
    SignIn,
    /// Signs X's page out.
    SignOut,
}

impl Command {
    /// Whether it's a command X's page can take.
    fn is_sound(&self) -> bool {
        match self {
            Command::Like { id } | Command::Watch { id } | Command::Thread { id } => is_post_id(id),
            Command::Volume { percent } => *percent <= 100,
            Command::Speakers { speakers } => speakers.as_deref().is_none_or(speakers::are_sound),
            Command::Head { head } => head.is_sound(),
            Command::Outside { distance, .. } => distance.is_finite() && (0.0..10_000.0).contains(distance),
            Command::Equalizer { equalizer } => equalizer.clamped() == *equalizer,
            _ => true,
        }
    }
}

/// A post's id: digits, of a sensible length.
fn is_post_id(id: &str) -> bool {
    (5..=25).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

/// An X handle (without its `@`): 1 to 15 letters, digits and `_`.
fn is_handle(handle: &str) -> bool {
    (1..=15).contains(&handle.len()) && handle.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// An image on X's own image host.
fn is_x_image(url: &str) -> bool {
    url.starts_with("https://pbs.twimg.com/")
}

/// `text` cut to `most` characters, without control characters but its lines.
fn plain(text: &mut String, most: usize) {
    text.retain(|c| c == '\n' || !c.is_control());
    if let Some((at, _)) = text.char_indices().nth(most) {
        text.truncate(at);
    }
}

/// What X's page says of itself: only these fields (it's x.com talking, so nothing else of it is passed on).
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct State {
    pub loaded: bool,
    pub signed_in: bool,
    /// The post whose page it is (`None`: the timeline, or another page).
    pub status: Option<String>,
    /// The post's page has its video, and whether it plays.
    pub video: bool,
    pub playing: bool,
    /// How loud the truck's speakers play (youtube.rs's `cab_level`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cab_level: Option<[f32; 3]>,
}

impl State {
    fn sound(mut self) -> Self {
        if self.status.as_deref().is_some_and(|id| !is_post_id(id)) {
            self.status = None;
        }
        self.cab_level = self
            .cab_level
            .filter(|told| told.iter().all(|v| v.is_finite()))
            .map(|[left, right, limited]| [left.clamp(0.0, 1.0), right.clamp(0.0, 1.0), limited.clamp(-60.0, 0.0)]);
        self
    }
}

/// A post, as the app shows it: its author, text, pictures (X's), its video's still (`Some("")`: a video without
/// one), X's own counts ("1.2K") and the time it was posted (ISO 8601).
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub id: String,
    /// Whom it answers (their handles), if it's a reply.
    #[serde(default)]
    pub reply_to: Vec<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub handle: String,
    #[serde(default)]
    pub avatar: Option<String>,
    /// "Someone reposted", "Pinned"...
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub video: Option<String>,
    #[serde(default)]
    pub replies: String,
    #[serde(default)]
    pub reposts: String,
    #[serde(default)]
    pub likes: String,
    #[serde(default)]
    pub liked: bool,
    /// The post it quotes, shown inside it.
    #[serde(default)]
    pub quote: Option<Box<Quote>>,
}

/// The post a post quotes: its id (`None`: X doesn't link it), author, text, pictures and video's still, as a
/// post's.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Quote {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub handle: String,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub video: Option<String>,
}

/// A post's (or a quote's) author, text, time and pictures, kept to what can be shown.
fn sound_content(
    name: &mut String,
    handle: &mut String,
    avatar: &mut Option<String>,
    text: &mut String,
    time: &mut String,
    images: &mut Vec<String>,
    video: &mut Option<String>,
) {
    plain(name, 60);
    handle.retain(|c| c.is_ascii_alphanumeric() || c == '_');
    plain(handle, 20);
    plain(text, 1000);
    time.retain(|c| c.is_ascii_alphanumeric() || "-:.+".contains(c));
    plain(time, 40);
    if avatar.as_deref().is_some_and(|url| !is_x_image(url)) {
        *avatar = None;
    }
    images.retain(|url| is_x_image(url));
    images.truncate(4);
    if video.as_deref().is_some_and(|url| !url.is_empty() && !is_x_image(url)) {
        *video = Some(String::new());
    }
}

/// The timeline's posts, as read so far.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Timeline {
    pub which: Feed,
    pub posts: Vec<Post>,
}

impl Timeline {
    /// Only real posts, texts cut, pictures only from X's image host.
    fn sound(mut self) -> Self {
        self.posts.retain(|post| is_post_id(&post.id));
        self.posts.truncate(150);
        for post in &mut self.posts {
            let Post { name, handle, avatar, text, time, images, video, .. } = post;
            sound_content(name, handle, avatar, text, time, images, video);
            post.reply_to.retain(|handle| is_handle(handle));
            post.reply_to.truncate(5);
            plain(&mut post.context, 80);
            for count in [&mut post.replies, &mut post.reposts, &mut post.likes] {
                plain(count, 12);
            }
            if let Some(quote) = &mut post.quote {
                let Quote { id, name, handle, avatar, text, time, images, video } = &mut **quote;
                sound_content(name, handle, avatar, text, time, images, video);
                if id.as_deref().is_some_and(|id| !is_post_id(id)) {
                    *id = None;
                }
            }
        }
        self
    }
}

/// A post's conversation, as its page shows it: the posts it answers, it, the replies to it.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Thread {
    pub id: String,
    pub posts: Vec<Post>,
}

impl Thread {
    /// Only a real post's, its posts as a timeline's.
    fn sound(self) -> Option<Self> {
        if !is_post_id(&self.id) {
            return None;
        }
        let Timeline { posts, .. } = Timeline { which: Feed::ForYou, posts: self.posts }.sound();
        Some(Self { id: self.id, posts })
    }
}

/// What X's page said, or whether the sign-in window is open.
#[derive(Debug, PartialEq)]
pub enum Report {
    State(Box<State>),
    Timeline(Timeline),
    Thread(Thread),
    SignInWindow(bool),
    /// The sign-in window closed signed in, and X's page is yet to say it's signed in (`true`), or it has (or
    /// took too long: `false`).
    Confirming(bool),
    Spectrum(Vec<u8>),
}

/// What the page was told last of the cab (youtube.rs's).
type Told = (Option<Option<Vec<Speaker>>>, Option<Head>, Option<(bool, f32)>, Option<Equalizer>, Option<bool>);

pub struct Twitter {
    view: OffscreenWebView,
    frame: PageSize,
    outbox: RefCell<Outbox>,
    sign_in: RefCell<Option<SignInWindow>>,
    confirming: Confirming,
    pending: RefCell<Vec<Report>>,
    cab: RefCell<Told>,
}

impl Twitter {
    /// Opens X in a hidden WebView of `stage`'s frame (`width` x `height`), under the cabin page.
    pub fn start(stage: &Stage, width: u32, height: u32, user_data: &Path) -> Result<Self, webview::Error> {
        let view = OffscreenWebView::new(stage, width, height, user_data)?;
        view.log_as("x")?;
        view.show(false)?;
        stage.add(&view, false)?;
        view.add_startup_script(concat!(include_str!("cab_sound.js"), "\n", include_str!("twitter.js")))?;
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

    /// Carries out the page's command (`Close` is the caller's: [`Twitter::close`]).
    pub fn command(&self, command: &Command) -> windows::core::Result<()> {
        match command {
            command if !command.is_sound() => Ok(()),
            Command::Home => self.view.navigate(HOME),
            Command::Watch { id } | Command::Thread { id } => {
                self.view.navigate(&format!("https://x.com/i/status/{id}"))
            }
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
                    match SignInWindow::open(self.view.environment(), &signin::X) {
                        Ok(window) => {
                            *sign_in = Some(window);
                            self.pending.borrow_mut().push(Report::SignInWindow(true));
                        }
                        Err(e) => crate::startup::mark(&format!("host: the X sign-in window couldn't open: {e}")),
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

    /// Passes a command on to X's page (held until it's there; each page it's taken to gets what it's owed).
    fn pass(&self, command: &Command) -> windows::core::Result<()> {
        match self.outbox.borrow_mut().send(command) {
            Some(message) => self.view.post_json(&message),
            None => Ok(()),
        }
    }

    /// X's timeline again (signed in or out since).
    pub fn reload(&self) -> windows::core::Result<()> {
        self.view.navigate(HOME)
    }

    /// What X's page said since the last call, oldest first, and whether the sign-in window closed.
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

/// A message of X's page: the timeline's posts (`feed`), or what it says of itself.
fn read_report(message: &str) -> Option<Report> {
    let mut value: serde_json::Value = serde_json::from_str(message).ok()?;
    if let Some(feed) = value.get_mut("feed") {
        serde_json::from_value::<Timeline>(feed.take()).ok().map(|feed| Report::Timeline(feed.sound()))
    } else if let Some(thread) = value.get_mut("thread") {
        serde_json::from_value::<Thread>(thread.take()).ok().and_then(Thread::sound).map(Report::Thread)
    } else {
        serde_json::from_value::<State>(value).ok().map(|state| Report::State(Box::new(state.sound())))
    }
}

/// The commands for X's page, as JSON: held until it says it's there; each page it's taken to (the timeline, a
/// post's) gets the volume, playing or paused, and the cab's sound again.
#[derive(Default)]
struct Outbox {
    ready: bool,
    held: Vec<String>,
    feed: Option<String>,
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
            Command::Feed { .. } => self.feed = Some(message.clone()),
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
            [
                &self.feed,
                &self.volume,
                &self.playing,
                &self.speakers,
                &self.head,
                &self.outside,
                &self.equalizer,
                &self.spectrum,
            ]
            .into_iter()
            .flatten()
            .cloned()
            .collect()
        } else {
            std::mem::take(&mut self.held)
        }
    }
}

/// `{"type":"twitter","state":{...},"signingIn":…}`: what X's page says (`null`: X isn't running), and whether its
/// sign-in is under way.
pub fn state_message(state: Option<&State>, signing_in: bool) -> String {
    serde_json::json!({ "type": "twitter", "state": state, "signingIn": signing_in }).to_string()
}

/// `{"type":"twitterThread","id":…,"posts":[…]}`: a post's conversation.
pub fn thread_message(thread: &Thread) -> String {
    let mut message = serde_json::to_value(thread).expect("threads serialise");
    message["type"] = "twitterThread".into();
    message.to_string()
}

/// `{"type":"twitterFeed","which":…,"posts":[…]}`: the timeline's posts.
pub fn timeline_message(timeline: &Timeline) -> String {
    let mut message = serde_json::to_value(timeline).expect("timelines serialise");
    message["type"] = "twitterFeed".into();
    message.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_pages_commands() {
        let read = |text: &str| serde_json::from_str::<Command>(text).ok();
        assert_eq!(read(r#"{"action":"feed","which":"forYou"}"#), Some(Command::Feed { which: Feed::ForYou }));
        assert_eq!(
            read(r#"{"action":"watch","id":"1850000000000000000"}"#),
            Some(Command::Watch { id: "1850000000000000000".into() })
        );
        assert_eq!(read(r#"{"action":"more"}"#), Some(Command::More));
        assert_eq!(read(r#"{"action":"explode"}"#), None);
        assert!(!Command::Watch { id: "../settings".into() }.is_sound());
        assert!(!Command::Like { id: "12".into() }.is_sound());
    }

    #[test]
    fn tells_a_posts_conversation_and_whom_a_reply_answers() {
        let message = r#"{"thread":{"id":"1850000000000000002","posts":[
            {"id":"1850000000000000001","name":"NASA","text":"Question?"},
            {"id":"1850000000000000002","name":"Me","replyTo":["NASA","not a handle!"],"text":"Answer.",
             "quote":{"id":"../x","name":"ESA","handle":"esa","text":"Look!","images":["https://pbs.twimg.com/media/q.jpg","https://evil.example/q.jpg"]}}
        ]}}"#;
        let Some(Report::Thread(thread)) = read_report(message) else { panic!("a thread") };
        assert_eq!(thread.posts.len(), 2);
        assert_eq!(thread.posts[1].reply_to, ["NASA"]);
        let quote = thread.posts[1].quote.as_deref().expect("its quote");
        assert_eq!((quote.id.as_deref(), quote.text.as_str()), (None, "Look!"));
        assert_eq!(quote.images, ["https://pbs.twimg.com/media/q.jpg"]);
        assert!(thread_message(&thread).contains(r#""type":"twitterThread""#));
        assert!(read_report(r#"{"thread":{"id":"../x","posts":[]}}"#).is_none());
        assert!(!Command::Thread { id: "x".into() }.is_sound());
    }

    #[test]
    fn passes_on_only_real_posts_and_xs_pictures() {
        let message = r#"{"feed":{"which":"following","posts":[
            {"id":"1850000000000000001","name":"NASA","handle":"NASA","avatar":"https://pbs.twimg.com/profile_images/a.jpg",
             "text":"Hello\nworld","time":"2026-10-27T10:00:00.000Z","images":["https://pbs.twimg.com/media/b.jpg","https://evil.example/c.jpg"],
             "video":"https://evil.example/poster.jpg","replies":"12","reposts":"3","likes":"1.2K","liked":true,"extra":1},
            {"id":"nope","text":"x"}
        ]}}"#;
        let Some(Report::Timeline(feed)) = read_report(message) else { panic!("a timeline") };
        assert_eq!(feed.which, Feed::Following);
        assert_eq!(feed.posts.len(), 1);
        let post = &feed.posts[0];
        assert_eq!(post.text, "Hello\nworld");
        assert_eq!(post.images, ["https://pbs.twimg.com/media/b.jpg"]);
        assert_eq!(post.video.as_deref(), Some(""));
        assert!(timeline_message(&feed).contains(r#""type":"twitterFeed""#));
        let state = r#"{"loaded":true,"signedIn":true,"status":null,"video":false,"playing":false}"#;
        assert!(matches!(read_report(state), Some(Report::State(_))));
    }
}
