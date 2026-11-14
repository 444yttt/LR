// Image credits for the vehicle photos (full record: assets/vehicles/ATTRIBUTION.md). Shown in the Add vehicle sheet,
// because CC BY / CC BY-SA require visible attribution. Pure TS so tests can check it against ATTRIBUTION.md.
export type Credit = { vehicle: string; file: string; author: string; license: string; licenseUrl: string; source: string; changes: string };

export const vehicleCredits: readonly Credit[] = [
  {
    vehicle: 'Range Rover (L460)', file: 'range-rover-l460.png', author: 'Damian B Oh', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Land_Rover_Range_Rover_P530_Autobiography_LWB_L460_Santorini_Black_(10).jpg',
    changes: 'Cut out, mirrored, glass tinted, wheels and trim darkened. The modified image is CC BY-SA 4.0.',
  },
  {
    vehicle: 'Ferrari 296', file: 'ferrari-296.png', author: 'Phillip Pessar', license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Red_Ferrari_Brickell,_Miami_Florida_March_2026.jpg',
    changes: 'Cut out and recoloured from red to white.',
  },
  {
    vehicle: 'BMW X7', file: 'bmw-x7.png', author: 'Retired electrician', license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    source: 'https://commons.wikimedia.org/wiki/File:Moscow,_BMW_SUV,_Moskovsky-117_dredger,_May_2026_02.jpg',
    changes: 'Cut out, paint neutralised to black, wheels darkened.',
  },
];
