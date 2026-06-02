import axios from 'axios';

export interface WeatherData {
  city: string;
  current: {
    temp: number;
    description: string;
    humidity: number;
    windSpeed: number;
  };
  forecast: Array<{
    date: string;
    maxTemp: number;
    minTemp: number;
    description: string;
    rainProbability: number;
  }>;
}

const WMO: Record<number, string> = {
  0: 'cielo despejado',
  1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'niebla', 48: 'niebla con escarcha',
  51: 'llovizna ligera', 53: 'llovizna moderada', 55: 'llovizna intensa',
  61: 'lluvia ligera', 63: 'lluvia moderada', 65: 'lluvia intensa',
  71: 'nieve ligera', 73: 'nieve moderada', 75: 'nieve intensa',
  80: 'chubascos ligeros', 81: 'chubascos moderados', 82: 'chubascos fuertes',
  95: 'tormenta', 96: 'tormenta con granizo', 99: 'tormenta fuerte',
};

const describe = (code: number) => WMO[code] ?? 'condiciones variables';

// Cache de geocoding para no repetir llamadas por la misma ciudad
const geoCache = new Map<string, { lat: string; lon: string; name: string }>();

async function geocodeCity(cityName: string): Promise<{ lat: string; lon: string; name: string } | null> {
  const key = cityName.toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key)!;

  try {
    const { data } = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: cityName, count: 1, language: 'es', format: 'json' },
      timeout: 5000,
    });
    const r = data.results?.[0];
    if (!r) return null;
    const result = { lat: String(r.latitude), lon: String(r.longitude), name: r.name as string };
    geoCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

async function fetchWeatherFromCoords(lat: string, lon: string, city: string): Promise<WeatherData> {
  const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m',
      daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: 3,
    },
  });

  const c = data.current;
  const d = data.daily;

  return {
    city,
    current: {
      temp: Math.round(c.temperature_2m),
      description: describe(c.weather_code),
      humidity: c.relative_humidity_2m,
      windSpeed: Math.round(c.wind_speed_10m),
    },
    forecast: d.time.map((date: string, i: number) => ({
      date,
      maxTemp: Math.round(d.temperature_2m_max[i]),
      minTemp: Math.round(d.temperature_2m_min[i]),
      description: describe(d.weather_code[i]),
      rainProbability: d.precipitation_probability_max[i] ?? 0,
    })),
  };
}

// Ciudad base desde .env — sin geocoding, uso normal
export async function getWeather(): Promise<WeatherData> {
  return fetchWeatherFromCoords(
    process.env.WEATHER_LAT  ?? '40.4168',
    process.env.WEATHER_LON  ?? '-3.7038',
    process.env.WEATHER_CITY ?? 'Madrid'
  );
}

// Ciudad dinámica — geocodifica si es diferente a la base
export async function getWeatherForCity(cityName: string): Promise<WeatherData> {
  const envCity = (process.env.WEATHER_CITY ?? '').toLowerCase().trim();
  if (cityName.toLowerCase().trim() === envCity) return getWeather();

  const geo = await geocodeCity(cityName);
  if (!geo) {
    console.warn(`⚠️  No se pudo geocodificar "${cityName}" — usando ciudad base`);
    return getWeather();
  }
  return fetchWeatherFromCoords(geo.lat, geo.lon, geo.name);
}
