// Image credits for the Wikimedia Commons vehicle photos (full record: assets/vehicles/ATTRIBUTION.md). Shown in the Add
// vehicle sheet, because CC BY / CC BY-SA require visible attribution. Pure TS so tests can check it against ATTRIBUTION.md.
export type Credit = { vehicle: string; file: string; author: string; license: string; licenseUrl: string; source: string; changes: string };

export const vehicleCredits: readonly Credit[] = [
  {
    vehicle: 'Ferrari 296', file: 'ferrari-296.png', author: 'Phillip Pessar', license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Red_Ferrari_Brickell,_Miami_Florida_March_2026.jpg',
    changes: 'Cut out and recoloured from red to white.',
  },
];

/** Vehicle images supplied by the app owner, who provided their source and licence. Not credited in the app. */
export const ownerSuppliedImages: readonly string[] = ['range-rover-l460.png', 'bmw-x7.png'];
