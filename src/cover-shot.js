/**
 * The `genex-cover` demo: the sea dragon crossing the reef while high-power bullets streak at
 * it and a just-caught fish bursts into coins. The game's own world, light and effects; the HUD,
 * aim cue and payout numbers are hidden. Ends paused so the photo is the same every time.
 */
export function makeCoverShots(api) {
  function stage({ cam, dragonAt, catchAt }) {
    api.reset();
    api.startPlay();
    api.clearFish();
    const dragon = api.forceSpawn("dragon", dragonAt[0], dragonAt[1]);
    api.forceSpawn("turtle", dragonAt[0] + 9, dragonAt[1] + 4.5);
    api.forceSpawn("angel", catchAt[0] - 1, catchAt[1] - 3);
    for (let i = 0; i < 5; i++) api.forceSpawn("clown", -8 + i * 1.2, 4 + (i % 2) * 1.1);
    for (let i = 0; i < 4; i++) api.forceSpawn("tang", 7 + (i % 2) * 1.4, -6 + i * 0.9);
    api.forceSpawn("manta", 11, 2);
    api.setBet(10);
    // let everything swim into its pose, dragon body bending behind its head
    api.simulate(2.2);
    // a volley at the dragon
    api.aimAt(dragon.pos);
    for (let i = 0; i < 3; i++) {
      api.fire();
      api.simulate(0.09);
    }
    // a fish just caught: the game's own net + coin burst
    api.catchEffect(catchAt[0], catchAt[1]);
    api.simulate(0.04);
    api.hideOverlays();
    api.camera(cam);
    window.__studio.pause();
    return { dragon: true };
  }
  return {
    // high oblique over the cannon toward the dragon (the game's own angle, lower and closer)
    a: () => stage({ cam: { pos: [2.5, 21, 13], look: [-1.5, 1.5, -1.8], fov: 42 }, dragonAt: [-6, -5], catchAt: [6, -2] }),
    // lower, closer on the dragon
    b: () => stage({ cam: { pos: [1, 14, 9], look: [-3, 2, -3.5], fov: 38 }, dragonAt: [-5, -4], catchAt: [2, -2] }),
  };
}
