---
name: NorthCape 4000
description: A cycling journal alongside an interactive atlas of the ride.
colors:
  route: "#ff806f"
  route-hover: "#ff9c8e"
  route-ink: "#a32f25"
  ink: "#11182b"
  sea: "#151e34"
  land: "#222f48"
  border: "#38435b"
  grid: "#536380"
  muted: "#b6bfda"
  white: "#fff8f8"
  paper: "#f4f1f5"
  copy: "#3f4352"
  rule: "#d8d3df"
typography:
  display:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "clamp(4.4rem, 8.1vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.79
    letterSpacing: "-.025em"
  headline:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "clamp(2.6rem, 5vw, 4.4rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-.022em"
  title:
    fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif'
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-.015em"
  body:
    fontFamily: "Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.68
  label:
    fontFamily: '"Work Sans", system-ui, sans-serif'
    fontSize: ".8rem"
    fontWeight: 550
    lineHeight: 1.35
rounded:
  control: "3px"
  dot: "50%"
spacing:
  section: "clamp(3.5rem, 7vw, 7rem)"
  chapter-head: "1.5rem"
  paragraph: "1.12em"
  photo-gap: ".7rem"
  chapter-tab-gap: ".35rem"
components:
  masthead:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    padding: ".5rem clamp(1.25rem, 3.65vw, 4.5rem)"
  read-story:
    backgroundColor: "{colors.route}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".6rem 1.05rem"
  read-story-hover:
    backgroundColor: "{colors.route-hover}"
  atlas:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
  chapter-tab:
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
  chapter-tab-current:
    backgroundColor: "{colors.route}"
    textColor: "{colors.ink}"
  map-pin:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.dot}"
  map-pin-current:
    backgroundColor: "{colors.route}"
    textColor: "{colors.ink}"
  chapter-heading:
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
  ride-facts:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  route-return:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    padding: ".5rem 1rem calc(.5rem + env(safe-area-inset-bottom))"
---

# Design System for NorthCape 4000

<!-- impeccable:design-map -->
Name: NorthCape 4000
Colors: primary: route #ff806f; neutral: ink #11182b; primary: route-hover #ff9c8e; primary: route-ink #a32f25; neutral: sea #151e34; neutral: land #222f48; neutral: border #38435b (+6 more in the sidecar)
Fonts: Barlow Condensed (display, headline, title); Georgia (body); Work Sans (label)
Spacing: section clamp(3.5rem, 7vw, 7rem), chapter-head 1.5rem, paragraph 1.12em, photo-gap .7rem, chapter-tab-gap .35rem
Radius: control 3px, dot 50%
North Star: "A ride journal beside an atlas"
Rules:
- The Route Color Rule. Use coral for the route and its corresponding chapter states.
Do:
- Do keep route styles distinct in the geometry and the legend.
- Do preserve visible focus on chapter links and map pins.
- Do keep photograph captions and dates directly below their images.
Full: .impeccable/design-full.md (read a section when you need its detail)
