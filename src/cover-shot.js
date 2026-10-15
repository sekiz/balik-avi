/**
 * The `genex-cover` demo: the sea dragon snaking across the reef while a high-power volley
 * streaks up at it from the cannon and a just-caught fish bursts into coins. The game's own
 * world, light and effects; the HUD, aim cue and payout numbers are hidden. Ends paused.
 */
export function makeCoverShots(api) {
  function stage({ swim, height, back, fov, side }) {
    api.reset();
    api.startPlay();
    api.clearFish();
    const dragon = api.forceSpawn("dragon", side * 9, -5.5);
    for (let i = 0; i < 5; i++) api.forceSpawn("clown", -12 + i * 1.3, 2 + (i % 2) * 1.2);
    for (let i = 0; i < 4; i++) api.forceSpawn("tang", 9 + (i % 2) * 1.5, 1 + i * 1.0);
    api.forceSpawn("angel", -6, 5);
    api.forceSpawn("puffer", 6, 5.5);
    api.forceSpawn("yellow", -2, 6.5);
    api.setBet(10);
    // let the dragon swim into a full S-curve
    api.simulate(swim);
    // a volley at the dragon, caught mid-flight
    api.aimAt(dragon.pos);
    for (let i = 0; i < 3; i++) {
      api.fire();
      api.simulate(0.08);
    }
    // a fish just caught off to the side: the game's own net + coin burst
    api.catchEffect(-side * 7, 3.5);
    api.simulate(0.05);
    api.hideOverlays();
    const c = api.cannonPos();
    const d = dragon.pos;
    api.camera({
      pos: [d.x * 0.35, height, c.z + back],
      look: [d.x * 0.55, 2, (d.z + c.z) / 2 - 1.5],
      fov,
    });
    window.__studio.pause();
    return { dragon: [d.x, d.z] };
  }
  return {
    a: () => stage({ swim: 4.5, height: 21, back: 5, fov: 40, side: -1 }),
    b: () => stage({ swim: 4.5, height: 17, back: 4, fov: 42, side: 1 }),
  };
}
