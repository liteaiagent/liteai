import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 9.47 119.7 36.38"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g fill="var(--icon-base)">
        <path d="M0 45.26L0 9.47L4.74 9.47L4.74 41.04L22.36 41.04L22.36 45.26L0 45.26ZM27.47 14.53L27.47 9.47L31.86 9.47L31.86 14.53L27.47 14.53M27.47 45.26L27.47 19.34L31.86 19.34L31.86 45.26L27.47 45.26ZM48.14 41.33L48.78 45.21Q46.92 45.61 45.46 45.61Q43.07 45.61 41.75 44.85Q40.43 44.09 39.89 42.86Q39.36 41.63 39.36 37.67L39.36 22.75L36.13 22.75L36.13 19.34L39.36 19.34L39.36 12.92L43.73 10.28L43.73 19.34L48.14 19.34L48.14 22.75L43.73 22.75L43.73 37.92Q43.73 39.79 43.96 40.33Q44.19 40.87 44.71 41.19Q45.24 41.50 46.22 41.50Q46.95 41.50 48.14 41.33ZM70.19 36.91L74.73 37.48Q73.66 41.46 70.75 43.65Q67.85 45.85 63.33 45.85Q57.64 45.85 54.31 42.35Q50.98 38.84 50.98 32.52Q50.98 25.98 54.35 22.36Q57.71 18.75 63.09 18.75Q68.29 18.75 71.58 22.29Q74.88 25.83 74.88 32.25Q74.88 32.64 74.85 33.42L55.52 33.42Q55.76 37.70 57.93 39.97Q60.11 42.24 63.35 42.24Q65.77 42.24 67.48 40.97Q69.19 39.70 70.19 36.91M55.76 29.81L70.24 29.81Q69.95 26.54 68.58 24.90Q66.48 22.36 63.13 22.36Q60.11 22.36 58.04 24.39Q55.98 26.42 55.76 29.81ZM76.88 45.26L90.63 9.47L95.73 9.47L110.38 45.26L104.98 45.26L100.81 34.42L85.84 34.42L81.91 45.26L76.88 45.26M87.21 30.57L99.34 30.57L95.61 20.65Q93.90 16.14 93.07 13.23Q92.38 16.67 91.14 20.07L87.21 30.57ZM114.97 45.26L114.97 9.47L119.70 9.47L119.70 45.26L114.97 45.26Z" />
      </g>
    </svg>
  )
}
