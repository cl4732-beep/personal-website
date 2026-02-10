interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  start_date_local: string;
  start_latlng: [number, number] | null;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
}

interface StravaAthleteStats {
  recent_run_totals: StravaTotals;
  recent_ride_totals: StravaTotals;
  recent_swim_totals: StravaTotals;
  ytd_run_totals: StravaTotals;
  ytd_ride_totals: StravaTotals;
  ytd_swim_totals: StravaTotals;
  all_run_totals: StravaTotals;
  all_ride_totals: StravaTotals;
  all_swim_totals: StravaTotals;
}

interface StravaTotals {
  count: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  elevation_gain: number;
}

let cachedTokens: StravaTokens | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedTokens && cachedTokens.expires_at > Date.now() / 1000 + 300) {
    return cachedTokens.access_token;
  }

  const response = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: import.meta.env.STRAVA_CLIENT_ID,
      client_secret: import.meta.env.STRAVA_CLIENT_SECRET,
      refresh_token: import.meta.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.status}`);
  }

  cachedTokens = await response.json();
  return cachedTokens!.access_token;
}

export async function getAthleteStats(): Promise<StravaAthleteStats> {
  const token = await getAccessToken();
  const athleteId = import.meta.env.STRAVA_ATHLETE_ID;
  const res = await fetch(
    `https://www.strava.com/api/v3/athletes/${athleteId}/stats`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    throw new Error(`Strava stats fetch failed: ${res.status}`);
  }

  return res.json();
}

export async function getRecentActivities(
  page = 1,
  perPage = 15
): Promise<StravaActivity[]> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    throw new Error(`Strava activities fetch failed: ${res.status}`);
  }

  return res.json();
}

export type { StravaActivity, StravaAthleteStats, StravaTotals };
