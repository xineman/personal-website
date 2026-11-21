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

## Overview

**Creative North Star: "A ride journal beside an atlas"**

Photographs from the ride introduce the terrain. The atlas follows the same journey through numbered stops, and the journal gives the story room to unfold in serif prose. Cool ink frames navigation and geography, lilac paper carries the text, and coral draws the eye to the route and its controls.

**Key Characteristics:**

- Photographs with location and date captions.
- Condensed headings, serif prose and sans-serif controls.
- Chapter numbers shared by the map, chapter navigation and article.

## Colors

### Primary

- **Route coral** traces the course, fills the reading action and marks the selected map pin and chapter link.
- **Light coral** signals hover on the reading action. **Dark coral** identifies chapter numbers on paper.

### Neutral

- **Blue ink** anchors the masthead and atlas and supplies dark text on paper and coral.
- **Sea, land and border** distinguish the map background, geography and outlines.
- **Warm white** carries titles and pin labels on ink. **Muted blue** carries supporting atlas text, region labels and ferry lines.
- **Lilac paper** carries the journal. **Slate copy** colors prose and captions, with **lilac rules** marking chapter boundaries and dividing ride facts.

**The Route Color Rule.** Use coral for the route and its corresponding chapter states. Use the darker coral for chapter numerals on paper.

## Typography

- **Display and headings.** Barlow Condensed at weight 800. The cover breaks into two uppercase lines. Story headings use balanced wrapping, and the atlas heading uses a smaller title size.
- **Running text.** Georgia at 1.125rem with a 1.68 line height and a maximum of 69ch. The first paragraph of the introduction is larger and uses blue ink. The running size drops to 1.05rem at widths of 480px and below.
- **Controls and supporting text.** Work Sans carries navigation, chapter pins and captions. MapLibre uses Noto Sans for geographic labels. Chapter numbers, controls and dates use tabular numerals where they align or change.

## Layout

Above 960px, the cover and journal use the left 58% of the spread and the sticky atlas uses the right 42%. The journal content is capped at 61rem including its fluid gutters. Chapter openings have a ruled top and a responsive gap, and photography can extend into the text gutters.

At 960px and below, the cover, atlas and journal stack in that order. At 480px and below, three-image strips give the first image a full-width square crop with the remaining two side by side. The cover also changes its crop and display scale at that width.

## Elevation & Depth

Ink and paper meet at thin rules. The cover darkens toward the bottom with a vertical ink gradient behind the title and action. A top rule separates the fixed mobile route bar from the article.

## Shapes

The page, atlas canvas and photographs use square edges. Chapter tabs and action links use 3px corners. Round map pins use a coral outline, and round dots separate short pieces of metadata.

## Components

### Masthead and reading action

The masthead pairs a coral compass and the story title with the Story and Route links. Supporting links brighten and underline on hover. The cover action uses a coral fill, dark text and a white keyboard focus outline.

### Atlas and chapter selector

The route uses a solid coral stroke for the recorded GPX track, a dashed coral stroke for the official course and a dashed muted-blue stroke for ferries. MapLibre renders the route on a north-up vector basemap. Readers can pan and zoom to inspect roads and places, then use Full route to return to the overview. On touch screens, two fingers move the map so a single finger can scroll the article. Pins, route segments and the six numbered links jump to chapter headings. As the reader enters a chapter, the atlas frames its GPX tracks and marks its pin and link in coral. Manual exploration and Full route stay in effect until the reading position changes chapters. The mobile Route link opens the atlas at the reader’s current chapter, and reduced-motion settings make camera changes immediate. Hovering a pin or route segment also emphasizes the segment, and focused pins have a visible ring.

### Journal chapters and photographs

A dark coral numeral sits on the heading baseline, with dates and location beneath the title. The preceding rule marks the start of a chapter. Photograph groups use one, two or three columns, with captions and dates below the images.

### Mobile route link

The full-width ink bar appears at the bottom of the screen after the atlas scrolls out of view. The centered link shows the current chapter number when one is active and returns readers to the atlas. The bar includes space for the bottom safe area.

## Do's and Don'ts

- **Do** keep route styles distinct in the geometry and the legend.
- **Do** preserve visible focus on chapter links and map pins.
- **Do** keep photograph captions and dates directly below their images.
