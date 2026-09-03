import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from '../api/axios';
import { useAuth } from '../context/AuthContext';

const SocketContext = createContext({ socket: null, connected: false });

export function SocketProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return undefined;
    }

    // `auth` as a function is re-evaluated on every (re)connection attempt,
    // so an automatic reconnect after a network blip always presents the
    // freshest in-memory access token rather than a stale one captured at
    // mount time.
    const socket = io('/', {
      path: '/socket.io',
      auth: (cb) => cb({ token: getAccessToken() }),
      withCredentials: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

// Convenience hook: subscribe to a socket event for the lifetime of the
// component, with automatic cleanup.
export function useSocketEvent(eventName, handler) {
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return undefined;
    socket.on(eventName, handler);
    return () => socket.off(eventName, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, eventName]);
}
