import { Switch as BeuiSwitch, type SwitchProps } from '../../registry/components/motion/switch'
export function Switch({ 'aria-label': ariaLabel, ...props }: Omit<SwitchProps, 'ariaLabel'> & { 'aria-label': string }) {
  return <BeuiSwitch {...props} ariaLabel={ariaLabel} className="scene-switch" />
}
