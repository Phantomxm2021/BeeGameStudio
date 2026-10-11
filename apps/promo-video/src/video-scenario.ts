export const videoScenario = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 1500,
  idea: 'Make a tabletop co-op pirate game.',
  brief: ['A shared island adventure', 'Four players, one living world', 'Build, sail, and survive together'],
  documents: ['Gameplay', 'World', 'GDD', 'Level Design', 'Balance', 'Technical', 'UI / UX', 'Architecture', 'Assets'],
  timings: {
    idea: [0, 120],
    brief: [120, 240],
    blueprint: [240, 540],
    audit: [540, 690],
    build: [690, 930],
    preview: [930, 1050],
    gameplay: [1050, 1290],
    delivery: [1290, 1410],
    cta: [1410, 1500],
  },
} as const;

export type VideoScenario = typeof videoScenario;
