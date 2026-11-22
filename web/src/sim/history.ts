// Earth through time: well-documented impact events, each labelled with its evidence class.
// "Observed" facts (crater size, date) come from the cited literature; projectile parameters are published
// reconstructions, used only to re-run the event in the Lab as a model check.
export interface HistoricalImpact {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Years before 2000 (negative = years ago), for the timeline; or calendar year for recent events. */
  age: string;
  ageYears: number; // years ago
  evidence: 'historical-record' | 'reconstruction';
  observed: string;
  /** Published estimate of the impactor, for re-running in the Lab; absent when no consensus exists. */
  params?: Record<string, number | string>;
  source: { label: string; url: string };
}

export const HISTORICAL_IMPACTS: HistoricalImpact[] = [
  { id: 'chelyabinsk', name: 'Chelyabinsk airburst', lat: 54.8, lon: 61.1, age: '15 Feb 2013', ageYears: 13, evidence: 'historical-record',
    observed: 'Observed airburst at ~27–30 km altitude, ~500 kt TNT; ~1,500 people injured, mostly by broken glass.',
    params: { diameter: 19, composition: 'custom', density: 3300, velocity: 19, angle: 18, target: 'sedimentary' },
    source: { label: 'Popova et al. (2013), Science 342', url: 'https://doi.org/10.1126/science.1242642' } },
  { id: 'tunguska', name: 'Tunguska event', lat: 60.886, lon: 101.894, age: '30 Jun 1908', ageYears: 118, evidence: 'historical-record',
    observed: 'About 2,150 km² of forest flattened; energy estimates range ~3–15 Mt. The impactor size is a reconstruction (~50–60 m stony body).',
    params: { diameter: 60, composition: 'stony', velocity: 15, angle: 35, target: 'sedimentary' },
    source: { label: 'Chyba, Thomas & Zahnle (1993), Nature 361', url: 'https://doi.org/10.1038/361040a0' } },
  { id: 'barringer', name: 'Meteor Crater (Barringer)', lat: 35.027, lon: -111.023, age: '~50,000 years ago', ageYears: 5e4, evidence: 'reconstruction',
    observed: 'Simple crater 1.2 km wide, ~180 m deep. Impactor reconstructed as an iron body of tens of metres at ~12–13 km/s.',
    params: { diameter: 50, composition: 'iron', velocity: 12.8, angle: 45, target: 'sedimentary' },
    source: { label: 'Melosh & Collins (2005), Nature 434', url: 'https://doi.org/10.1038/434157a' } },
  { id: 'ries', name: 'Nördlinger Ries', lat: 48.88, lon: 10.57, age: '14.8 million years ago', ageYears: 1.48e7, evidence: 'reconstruction',
    observed: 'Complex crater about 24 km across in southern Germany.',
    source: { label: 'Earth Impact Database, Planetary and Space Science Centre, UNB', url: 'http://www.passc.net/EarthImpactDatabase/' } },
  { id: 'popigai', name: 'Popigai', lat: 71.65, lon: 111.18, age: '35.7 million years ago', ageYears: 3.57e7, evidence: 'reconstruction',
    observed: 'One of the largest known craters, about 90–100 km across, in northern Siberia.',
    source: { label: 'Earth Impact Database, PASSC', url: 'http://www.passc.net/EarthImpactDatabase/' } },
  { id: 'chicxulub', name: 'Chicxulub', lat: 21.4, lon: -89.5, age: '66.0 million years ago', ageYears: 6.6e7, evidence: 'reconstruction',
    observed: 'Buried crater ~180 km across under Yucatán; linked to the end-Cretaceous mass extinction. Impactor reconstructed at ~10 km and ~20 km/s.',
    params: { diameter: 10000, composition: 'stony', velocity: 20, angle: 60, target: 'sedimentary' },
    source: { label: 'Schulte et al. (2010), Science 327', url: 'https://doi.org/10.1126/science.1177265' } },
  { id: 'vredefort', name: 'Vredefort', lat: -27.0, lon: 27.5, age: '2.02 billion years ago', ageYears: 2.02e9, evidence: 'reconstruction',
    observed: 'Oldest and largest confirmed structure; eroded, original diameter estimated ~170–300 km.',
    source: { label: 'Earth Impact Database, PASSC', url: 'http://www.passc.net/EarthImpactDatabase/' } },
];
