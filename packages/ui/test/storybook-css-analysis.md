# Storybook vs Web App - Chat Pane CSS Analysis

This document outlines the visual and computed CSS differences between the `ChatPane` component as rendered in the main Web application (`localhost:3000`) and the Storybook environment (`localhost:6006`). 

## Background
During visual QA, discrepancies were observed in the typography, spacing, and layout of the Chat Pane despite both environments utilizing the same underlying React/Solid component and CSS variable structure (OC-2 theme). A browser-based inspection was performed to identify the exact computed styles causing these differences.

## 1. Typography & Spacing Differences

The most significant visual differences stem from how base font sizes and line heights are inherited from the respective environments' root elements.

| Element | Property | Web App (`:3000`) | Storybook (`:6006`) | Difference |
| :--- | :--- | :--- | :--- | :--- |
| **Chat Container (Root)** | Font Family | `Inter, "Inter Fallback"` | `Inter, "Inter Fallback"` | Matches perfectly |
| | Font Size | **13px** | **16px** | Storybook defaults to the browser's 16px base size. |
| | Line Height | **19.5px** | **24px** | Storybook spacing is taller (~4.5px difference). |
| **User Message Text** | Font Size | 14px | 14px | Matches (due to explicit component-level Tailwind classes). |
| | Line Height | **21px** | **25.2px** | Storybook has looser text spacing (4.2px taller line height) falling back to browser defaults. |
| **Chat Input Text** | Font Size | 14px | 14px | Matches. |
| | Line Height | 25.2px | 25.2px | Matches. |

## 2. Background Colors & Contrast

While the CSS variables from the OC-2 theme are correctly loading in Storybook, the base background color applied to the environment differs, significantly altering the perceived contrast of the components.

| Element | Property | Web App (`:3000`) | Storybook (`:6006`) | Difference |
| :--- | :--- | :--- | :--- | :--- |
| **Main Chat Background** | `background-color`| `rgb(252, 252, 252)` | `rgb(255, 255, 255)` | The Web app uses a subtle light-gray (`bg-background-stronger`), while Storybook defaults to pure white, washing out the input box contrast walls. |
| **All Text Elements** | `color`| `rgb(7, 5, 4)` | `rgb(7, 5, 4)` | Text colors match perfectly (using the theme's core text token). |

## 3. Structural Layout & Container Queries

Beyond typography and colors, there are structural layout differences causing the pane to behave differently, particularly regarding responsiveness:

1. **Missing `@container` Context**: 
   - **Web App**: The production application uses Tailwind's `@container` modifier on a parent layout element.
   - **Storybook**: Renders the Chat Pane in a standard `normal` container type context. Any internal component CSS relying on container queries (like responsive collapsing of UI elements) fails to trigger in Storybook.
   
2. **Missing Layout Wrappers**: 
   - **Web App**: Wraps the chat pane in root classes like `flex flex-col h-dvh p-px` to enforce fullscreen behavior and correct flex-box sizing.
   - **Storybook**: Renders the component in isolation as a standard `block` element with a default `24px` padding (`.sb-main-padded`), causing it to appear as a floating, unconstrained box rather than a full-height sidebar.

## Recommendations for Storybook Calibration

To make the Storybook environment perfectly match the Web app layout, update the `.storybook/preview.tsx` decorators or configuration to:

1. **Apply Base Body Classes**: Wrap stories in the base application body classes (e.g., `text-[13px] leading-[19.5px]` or the corresponding global utility defining base text).
2. **Set Global Background**: Set the global Storybook body background to `--background-base`.
3. **Simulate Layout Wrappers**: Wrap the Chat Pane story in a container `div` that includes the `@container flex h-full` classes, mimicking the actual layout context and enabling container queries to function.
