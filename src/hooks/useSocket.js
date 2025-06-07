import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const BASE_URL = process.env.REACT_APP_API_URL;
const useSocket = (user) => {
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!user) return;

    const newSocket = io(`${BASE_URL}`, {
      transports: ['websocket'],
      withCredentials: true,
    });

    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      console.log('✅ Connected to socket:', newSocket.id);
      newSocket.emit('join', {
        userId: user._id,
        username: user.username,
        room: 'general',
      });
    });

    newSocket.on('connect_error', (err) => {
      console.error('❌ Socket connection error:', err.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user]);

  return socket;
};

export default useSocket;
