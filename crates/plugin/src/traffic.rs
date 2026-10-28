//! The game's AI traffic around the player, read from its memory for WestPlay's reports: its police cars and
//! tow trucks are published to the bridge every second (`sightings`), and the page makes reports of them. Each
//! model is logged the first time it's seen, each police car or tow truck as it comes, and the nearest
//! vehicles now and then (to learn other countries' police models from the log).
//!
//! The police's cars are named `<car>.pol_<country>...` (`traffic.megane.pol_fr_gen`, seen in France in 1.61,
//! 2026-10-27), tow trucks `<van>.tow...` (`traffic.daily.tow.eu.car2`).
//!
//! The SDK says nothing of the traffic. Its layout is the one the ETS2LA plugin reads (github.com/ETS2LA/plugin,
//! MIT, from Dario Wouters' ts-extra-utilities; for 1.60, Windows): the game's traffic object, found by the
//! code reading its global (`GAME_TRAFFIC`), holds the vehicles it spawned (`spawned_vehicles`), each a
//! `traffic_ai_vehicle_t` with its placement, its physics (its speed) and its model's names. Fields are offsets
//! from those headers and may move with a game update, so every read goes through `ReadProcessMemory`: a
//! wrong offset reads nothing (or nonsense, logged), never crashes the game.

use std::collections::HashSet;
use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use westplay_shared::{SIGHTED_POLICE, SIGHTED_TOW, SIGHTINGS_MAX, Sighting, Sightings};
use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentProcess;

use crate::navigation::Image;
use crate::{bridge, log};

/// `mov rbx, rcx; mov rcx, [rip+X]; test rcx, rcx; jz _; mov rax, [rbx+_]; test rax, rax` (ETS2LA's
/// `game_traffic` pattern): X is the global holding the game's traffic object.
const GAME_TRAFFIC: &[Option<u8>] = &[
    Some(0x48),
    Some(0x8b),
    Some(0xd9),
    Some(0x48),
    Some(0x8b),
    Some(0x0d),
    None,
    None,
    None,
    None,
    Some(0x48),
    Some(0x85),
    Some(0xc9),
    Some(0x74),
    None,
    Some(0x48),
    Some(0x8b),
    Some(0x83),
    None,
    None,
    None,
    None,
    Some(0x48),
    Some(0x85),
    Some(0xc0),
];

/// `traffic_u`: `array_dyn_t<spawned_vehicle_t>` (16-byte entries, the vehicle first) of the traffic spawned
/// around the player, and `array_dyn_t<traffic_ai_vehicle_t*>`, logged by its count only (what it holds isn't
/// known yet).
const SPAWNED_VEHICLES: usize = 0xf0;
const SPAWNED_ENTRY: usize = 0x10;
const AI_VEHICLES: usize = 0x168;
/// `array_t`: its values' address and how many (after its vtable).
const ARRAY_VALUES: usize = 0x08;
const ARRAY_SIZE: usize = 0x10;

/// `traffic_ai_vehicle_t`: its `placement_t` (position in its sector: three floats, then the sector's x and z,
/// 512 m each), its physics (`traffic_vehicle_physics_t*`, the speed at 0x70, m/s) and its model's names
/// (`string_dyn_t`: the text's address at 8, its length at 16).
const PLACEMENT: usize = 0x28;
const SECTOR_X: usize = 0x34;
const SECTOR_Z: usize = 0x36;
const PHYSICS: usize = 0x238;
const PHYSICS_SPEED: usize = 0x70;
const ID_NAME: usize = 0x510;
const TYPE_NAME: usize = 0x530;
const STRING_TEXT: usize = 0x08;
const STRING_LENGTH: usize = 0x10;

/// The most vehicles read (a wrong count reads no further).
const MOST_VEHICLES: usize = 256;
/// The longest name read.
const LONGEST_NAME: u32 = 128;
/// How often the traffic is read (and its vehicles of note published), and how often (and how many of) the
/// nearest vehicles are logged.
const READ_EVERY: Duration = Duration::from_secs(1);
const LOG_EVERY: Duration = Duration::from_secs(30);
const LOG_NEAREST: usize = 12;

/// The global holding the game's traffic object (0: not found).
static GLOBAL: AtomicUsize = AtomicUsize::new(0);

struct Seen {
    /// When the traffic was last read, and the nearest vehicles last logged.
    read: Option<Instant>,
    logged: Option<Instant>,
    /// The models (id and type names) logged so far.
    models: HashSet<(String, String)>,
    /// The vehicles of note logged so far (the game's objects for them).
    noted: HashSet<u64>,
}

static SEEN: Mutex<Option<Seen>> = Mutex::new(None);

/// Finds the game's traffic in the running game; logs whether it did.
///
/// # Safety
/// In the game's process (the plugin is loaded in it).
pub unsafe fn locate() {
    let found = (|| {
        // SAFETY: no name: the game's own executable, mapped for the process's life.
        let base = unsafe { GetModuleHandleW(None) }.ok()?.0 as usize;
        // SAFETY: `base` is the game's executable, as mapped.
        let image = unsafe { Image::of(base) }?;
        let at = image.unique_masked(GAME_TRAFFIC)?;
        let displacement = i32::from_le_bytes(image.code_at(at + 6, 4)?.try_into().ok()?);
        let global = (at + 10).wrapping_add_signed(displacement as isize);
        log!("traffic: found at +{:#x}", global - base);
        Some(global)
    })();
    if found.is_none() {
        log!("traffic: the game's traffic code isn't the version WestPlay knows; the traffic isn't read");
    }
    GLOBAL.store(found.unwrap_or(0), Ordering::Release);
}

/// A vehicle of the traffic, as read: `id` the game's object for it.
struct Vehicle {
    id: u64,
    x: f64,
    y: f32,
    z: f64,
    speed: Option<f32>,
    id_name: String,
    type_name: String,
}

/// Reads the traffic around the truck at `truck` (world x, y, z) every second: its police cars and tow trucks
/// published to the bridge (as of the game's frame `frame`), what's new logged. Called at the end of the game's
/// frames, on its main thread (the traffic is the game's to change, between frames).
pub fn update(truck: [f64; 3], frame: u64) {
    let global = GLOBAL.load(Ordering::Acquire);
    if global == 0 {
        return;
    }
    let mut seen = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let seen =
        seen.get_or_insert_with(|| Seen { read: None, logged: None, models: HashSet::new(), noted: HashSet::new() });
    if seen.read.is_some_and(|at| at.elapsed() < READ_EVERY) {
        return;
    }
    seen.read = Some(Instant::now());

    let Some(traffic) = read::<usize>(global).filter(|&a| a != 0) else {
        publish(Sightings { frame, ..Sightings::default() });
        return;
    };
    let (vehicles, spawned) = spawned_vehicles(traffic);
    let ai_count = read::<u64>(traffic + AI_VEHICLES + ARRAY_SIZE);

    for vehicle in &vehicles {
        let model = (vehicle.id_name.clone(), vehicle.type_name.clone());
        if seen.models.insert(model) {
            log!("traffic: new model {:?} / {:?}{}", vehicle.id_name, vehicle.type_name, note_of(vehicle));
        }
    }

    let distance = |v: &Vehicle| ((v.x - truck[0]).powi(2) + (v.z - truck[2]).powi(2)).sqrt();
    let mut nearest: Vec<&Vehicle> = vehicles.iter().collect();
    nearest.sort_by(|a, b| distance(a).total_cmp(&distance(b)));

    // The vehicles of note, nearest first.
    let mut sightings = Sightings { frame, ..Sightings::default() };
    for (vehicle, kind) in nearest.iter().filter_map(|&v| kind_of(v).map(|kind| (v, kind))).take(SIGHTINGS_MAX) {
        if seen.noted.insert(vehicle.id) {
            log!(
                "traffic: {} {:?} at {:.0}, {:.0}, {:.0} m away, {:.0} km/h",
                if kind == SIGHTED_POLICE { "police" } else { "tow truck" },
                vehicle.id_name,
                vehicle.x,
                vehicle.z,
                distance(vehicle),
                vehicle.speed.unwrap_or(0.0).abs() * 3.6
            );
        }
        sightings.vehicles[sightings.count as usize] =
            Sighting { id: vehicle.id, x: vehicle.x, z: vehicle.z, speed: vehicle.speed.unwrap_or(0.0).abs(), kind };
        sightings.count += 1;
    }
    publish(sightings);

    if seen.logged.is_some_and(|at| at.elapsed() < LOG_EVERY) {
        return;
    }
    seen.logged = Some(Instant::now());
    log!(
        "traffic: {} spawned ({} read), ai list {:?}, truck at {:.0}, {:.0}",
        spawned,
        vehicles.len(),
        ai_count,
        truck[0],
        truck[2]
    );
    for vehicle in nearest.into_iter().take(LOG_NEAREST) {
        log!(
            "traffic:   {:>6.0} m  {:>4} km/h  {:?} / {:?} at {:.0}, {:.1}, {:.0}{}",
            distance(vehicle),
            vehicle.speed.map_or("?".into(), |s| format!("{:.0}", s.abs() * 3.6)),
            vehicle.id_name,
            vehicle.type_name,
            vehicle.x,
            vehicle.y,
            vehicle.z,
            note_of(vehicle)
        );
    }
}

fn publish(sightings: Sightings) {
    if let Some(bridge) = bridge::get() {
        bridge.plugin.sightings.write(&sightings);
    }
}

/// What a vehicle is of note as, by its model's name: a police car or a tow truck.
fn kind_of(vehicle: &Vehicle) -> Option<u8> {
    let name = vehicle.id_name.to_lowercase();
    if name.contains(".pol_") || name.contains("police") {
        Some(SIGHTED_POLICE)
    } else if name.contains(".tow") {
        Some(SIGHTED_TOW)
    } else {
        None
    }
}

/// What the log says after a vehicle of note.
fn note_of(vehicle: &Vehicle) -> &'static str {
    match kind_of(vehicle) {
        Some(SIGHTED_POLICE) => "  <-- police",
        Some(_) => "  <-- tow truck",
        None => "",
    }
}

/// The vehicles the traffic spawned, as read, and how many it says there are.
fn spawned_vehicles(traffic: usize) -> (Vec<Vehicle>, u64) {
    let array = traffic + SPAWNED_VEHICLES;
    let (Some(values), Some(count)) = (read::<usize>(array + ARRAY_VALUES), read::<u64>(array + ARRAY_SIZE)) else {
        return (Vec::new(), 0);
    };
    if values == 0 {
        return (Vec::new(), count);
    }
    let vehicles = (0..(count as usize).min(MOST_VEHICLES))
        .filter_map(|i| read::<usize>(values + i * SPAWNED_ENTRY))
        .filter(|&vehicle| vehicle != 0)
        .filter_map(vehicle_at)
        .collect();
    (vehicles, count)
}

fn vehicle_at(at: usize) -> Option<Vehicle> {
    let [x, y, z] = read::<[f32; 3]>(at + PLACEMENT)?;
    let sector_x = read::<i16>(at + SECTOR_X)?;
    let sector_z = read::<i16>(at + SECTOR_Z)?;
    let speed = read::<usize>(at + PHYSICS).filter(|&p| p != 0).and_then(|p| read::<f32>(p + PHYSICS_SPEED));
    Some(Vehicle {
        id: at as u64,
        x: sector_x as f64 * 512.0 + x as f64,
        y,
        z: sector_z as f64 * 512.0 + z as f64,
        speed,
        id_name: string_at(at + ID_NAME).unwrap_or_default(),
        type_name: string_at(at + TYPE_NAME).unwrap_or_default(),
    })
}

/// A `string_dyn_t`'s text (cut at [`LONGEST_NAME`]).
fn string_at(at: usize) -> Option<String> {
    let text = read::<usize>(at + STRING_TEXT).filter(|&t| t != 0)?;
    let length = read::<u32>(at + STRING_LENGTH)?.min(LONGEST_NAME) as usize;
    let mut bytes = vec![0u8; length];
    read_into(text, &mut bytes)?;
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(length);
    Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
}

/// A plain value at `at` in the game's memory, if it can be read there.
fn read<T: Copy + Default>(at: usize) -> Option<T> {
    let mut value = T::default();
    // SAFETY: `value` is a plain `T` (integers, floats, their arrays), valid for any bytes, written whole.
    let bytes = unsafe { std::slice::from_raw_parts_mut(&mut value as *mut T as *mut u8, size_of::<T>()) };
    read_into(at, bytes)?;
    Some(value)
}

/// Fills `bytes` from `at` in the game's memory, if all of it can be read: memory not mapped (an offset
/// gone wrong) fails the read rather than the game.
fn read_into(at: usize, bytes: &mut [u8]) -> Option<()> {
    let mut read = 0usize;
    // SAFETY: our own process, read into `bytes` (its length), which it owns; an address not readable is an
    // error returned, not a fault.
    unsafe {
        ReadProcessMemory(
            GetCurrentProcess(),
            at as *const c_void,
            bytes.as_mut_ptr() as *mut c_void,
            bytes.len(),
            Some(&mut read),
        )
    }
    .ok()?;
    (read == bytes.len()).then_some(())
}
