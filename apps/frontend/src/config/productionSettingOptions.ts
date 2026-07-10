export type ProductionSettingOptions = {
  platforms: string[]
  engines: string[]
  dimensions: string[]
  genres: string[]
  styles: string[]
  inputs: string[]
}

export const CONFIGURED_PRODUCTION_SETTING_OPTIONS: ProductionSettingOptions = {
  platforms: ['Web', 'Mobile', 'PC', 'Console', 'VR/AR'],
  engines: ['React', 'Unity', 'Godot', 'Unreal'],
  dimensions: ['2D', '2.5D', '3D', 'VR', 'AR'],
  genres: ['Arcade', 'Action', 'Adventure', 'Puzzle', 'Racing', 'RPG', 'Strategy', 'Simulation', 'Shooter', 'Platformer', 'Casual'],
  styles: ['Pixel', 'Cartoon', 'Stylized', 'Minimal', 'Realistic', 'Low Poly', 'Hand-drawn', 'Sci-fi', 'Fantasy'],
  inputs: ['Keyboard/mouse', 'Touch', 'Gamepad', 'Motion', 'Voice', 'Hand tracking'],
}
