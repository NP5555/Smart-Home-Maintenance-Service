import { execute, literal, single } from './support.js';

export const cityName = 'Lahore';
export const cityTimeZone = 'Asia/Karachi';

export const areaNames: readonly string[] = [
  'Gulberg',
  'Gulberg III',
  'DHA Phase 5',
  'DHA Phase 6',
  'DHA Phase 7',
  'Johar Town',
  'Faisal Town',
  'Model Town',
  'Bahria Town',
  'Bahria Town Phase 4',
  'Cantt',
  'Shalimar',
  'Green Town',
  'Samanabad',
  'Gulshan-e-Iqbal',
  'Askari 10',
  'PECHS',
  'Gulistan-e-Jauhar',
  'Wapda Town',
  'Shahdara',
  'Raiwind Road',
  'MMA Chowk',
  'Garden Town',
  'Muslim Town'
];

const approximateCentroid = (name: string): { lat: string; lng: string } => {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  const lat = 31.3 + (hash % 5_000) / 100_000;
  const lng = 74.2 + ((hash >> 3) % 5_000) / 100_000;
  return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
};

export const seedPlaces = async (): Promise<void> => {
  const city = await single<{ id: string }>(
    `INSERT INTO cities(name, timezone) VALUES (${literal(cityName)}, ${literal(cityTimeZone)})
     ON CONFLICT (name) DO UPDATE SET timezone = EXCLUDED.timezone RETURNING id`
  );
  if (city === null) throw new Error('City insert returned no row');
  for (const name of areaNames) {
    const centroid = approximateCentroid(name);
    await execute(
      `INSERT INTO areas(city_id, name, centroid)
       SELECT c.id, ${literal(name)}, ST_SetSRID(ST_MakePoint(${centroid.lng}, ${centroid.lat}), 4326)::geography
       FROM cities c WHERE c.id = '${city.id}'
         AND NOT EXISTS (SELECT 1 FROM areas a WHERE a.city_id = c.id AND a.name = ${literal(name)})`
    );
  }
};
