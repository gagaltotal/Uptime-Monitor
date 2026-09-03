import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  // Needed so the browser sends the httpOnly refresh cookie on
  // /auth/refresh and /auth/logout — never used to read the cookie from JS.
  withCredentials: true,
});

// The access token lives in memory only (module state), never in
// localStorage/sessionStorage — that's what keeps it safe from theft via a
// stored XSS payload. It's lost on a hard page reload by design, and
// silently re-obtained via the httpOnly refresh cookie (see AuthContext).
let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Called once from AuthContext to wire up how a failed silent-refresh
// should be handled (i.e. send the user back to the login screen).
let onSessionExpired = () => {};
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Only ever attempt this once per request, and never for the
    // refresh/login endpoints themselves (that would loop forever).
    const isAuthRoute = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

    if (status === 401 && !original._retry && !isAuthRoute) {
      original._retry = true;
      try {
        // Multiple requests failing at once should trigger a single shared
        // refresh call, not one per request.
        if (!refreshPromise) {
          refreshPromise = api.post('/auth/refresh').finally(() => {
            refreshPromise = null;
          });
        }
        const { data } = await refreshPromise;
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshError) {
        setAccessToken(null);
        onSessionExpired();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
