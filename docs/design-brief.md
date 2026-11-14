# Design Brief

## Challenge
NASA Space Apps Challenge 2026: **Dancing with the SARs**. Build an interactive application that uses NASA-ISRO NISAR radar data to show surface change around the world.

## Problem statement
Radar satellites see through clouds and darkness and record how Earth's surface changes. Their images are unfamiliar, so the public, students and even many decision-makers cannot read them.

## Target users
| User | Need | Pain today |
|------|------|-----------|
| Curious public, students | See what a disaster did to the ground | SAR images look like noise; no plain-language explanation |
| Teachers, science communicators | Ready, trustworthy examples of radar science | Data is buried in HDF5 files behind logins |
| Researchers, analysts | Quick look at which NISAR data exists for a place and date | Searching archives takes many tools |

## Goals and success criteria
- A first-time user can say what changed in each demo within a minute, without prior radar knowledge.
- Every image shows its mission, product, acquisition date, data tier and processing steps.
- At least one workflow runs on genuine NISAR data. We have three.

## Core features (MVP)
1. Photoreal 3D globe with real event markers (NISAR investigations plus USGS/EONET context), search and filters.
2. Before/after comparison (swipe, side-by-side, overlay) of real NISAR observations, with a timeline.
3. "What the radar sees" panel with Simple and Scientific levels, numbered annotation pins and a live legend.
4. Live NISAR coverage probe for any point on Earth (ASF SearchAPI).
5. Quantitative layers from the HDF5 products:
   - line-of-sight displacement (cm)
   - backscatter change (dB)
   - water masks

## Out of scope
- Predicting earthquakes or eruptions.
- Simulated imagery presented as observations.
- Subsidence time series and glacier velocity (future work).

## Design principles
- The map and the imagery dominate; panels support them.
- Dark, restrained, mission-control interface; one colour per event type.
- Never claim more than the data shows: hedge, cite and show uncertainty.
- Fewer events, analyzed properly, rather than many shallow ones.

## Open questions
- Official challenge wording and resources (spaceappschallenge.org was unreachable from our network).
- Space Apps rules on disclosing AI assistance.
