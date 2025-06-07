import { useState, useEffect, useRef, useCallback } from 'react';
import useSocket from '../hooks/useSocket';



const BASE_URL = process.env.REACT_APP_API_URL;

const Chat = ({ user, setUser }) => {
  const [darkMode, setDarkMode] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [privateChats, setPrivateChats] = useState({});
  const [currentPrivateUser, setCurrentPrivateUser] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [privateTypingUsers, setPrivateTypingUsers] = useState({});

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    audioRef.current = new Audio('/notify.mp3');
    audioRef.current.volume = 0.3;
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/api/users`)
      .then((res) => res.json())
      .then((data) => {
        // Filter out users with invalid usernames
        const validUsers = data.filter(user => user && user.username && typeof user.username === 'string');
        setAllUsers(validUsers);
      })
      .catch((err) => console.error('Failed to fetch users:', err));
  }, []);

  const socket = useSocket(user);

  useEffect(() => {
    if (!socket) return;

    socket.emit('join', { username: user.username });

    const handlers = {
      connect: () => setIsConnected(true),
      disconnect: () => setIsConnected(false),
      recentMessages: (recentMessages) => setMessages(recentMessages),
      newMessage: (message) => {
        setMessages(prev => [...prev, message]);
        if (message.sender.username !== user.username) {
          audioRef.current?.play().catch(e => console.log('Audio play failed:', e));
        }
      },
      privateTyping: ({ from, isTyping }) => {
        setPrivateTypingUsers(prev => {
          const updated = { ...prev };
          isTyping ? updated[from] = true : delete updated[from];
          return updated;
        });
      },
      userJoined: (data) => {
        const systemMessage = { _id: Date.now(), content: data.message, sender: { username: 'System' }, createdAt: new Date(), isSystem: true };
        setMessages(prev => [...prev, systemMessage]);
      },
      userLeft: (data) => {
        const systemMessage = { _id: Date.now(), content: data.message, sender: { username: 'System' }, createdAt: new Date(), isSystem: true };
        setMessages(prev => [...prev, systemMessage]);
      },
      userTyping: (data) => {
        if (data.isTyping) {
          setTypingUsers(prev => (!prev.includes(data.username) ? [...prev, data.username] : prev));
        } else {
          setTypingUsers(prev => prev.filter(username => username !== data.username));
        }
      },
      updateUserList: (users) => setOnlineUsers(users),
      privateMessage: ({ from, message, timestamp }) => {
        setPrivateChats(prev => ({ ...prev, [from]: [...(prev[from] || []), { from, message, timestamp, read: false, id: Date.now() + Math.random() }] }));
        if (from !== user.username) audioRef.current?.play().catch(e => console.log('Audio play failed:', e));
      }
    };

    Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler));
    return () => Object.keys(handlers).forEach(event => socket.off(event));
  }, [socket, user.username]);

  useEffect(() => {
    if (!socket) return;
    const handleMessageRead = ({ from, to }) => {
      if (to === user.username) {
        setPrivateChats(prev => {
          const updated = { ...prev };
          if (updated[from]) {
            updated[from] = updated[from].map(msg => msg.from === user.username ? { ...msg, read: true } : msg);
          }
          return updated;
        });
      }
    };
    socket.on('messageRead', handleMessageRead);
    return () => socket.off('messageRead', handleMessageRead);
  }, [socket, user.username]);

  useEffect(() => scrollToBottom(), [messages, privateChats, currentPrivateUser]);

  const markMessagesAsRead = useCallback(() => {
    if (!currentPrivateUser || !socket) return;
    setPrivateChats(prev => {
      const userChats = prev[currentPrivateUser];
      if (!userChats?.length) return prev;
      const unreadMessages = userChats.filter(msg => !msg.read && msg.from === currentPrivateUser);
      if (unreadMessages.length > 0) {
        socket.emit('messageRead', { from: user.username, to: currentPrivateUser });
        return { ...prev, [currentPrivateUser]: userChats.map(msg => msg.from === currentPrivateUser ? { ...msg, read: true } : msg) };
      }
      return prev;
    });
  }, [currentPrivateUser, socket, user.username]);

  useEffect(() => {
    if (currentPrivateUser) {
      const timer = setTimeout(() => markMessagesAsRead(), 100);
      return () => clearTimeout(timer);
    }
  }, [currentPrivateUser, markMessagesAsRead]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const handleInputChange = (e) => {
    setMessageInput(e.target.value);
    if (!socket) return;

    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', currentPrivateUser ? { to: currentPrivateUser, isTyping: true } : { room: 'general', isTyping: true });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('typing', currentPrivateUser ? { to: currentPrivateUser, isTyping: false } : { room: 'general', isTyping: false });
    }, 1000);
  };

  const handleFileChange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // File size validation (10MB limit)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    alert('File size must be less than 10MB');
    e.target.value = '';
    return;
  }
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json();
    
    console.log('Upload response:', data);
    
    let fileUrl = null;
    
  
    if (data.fileUrl) {
      fileUrl = data.fileUrl;
    } else if (data.url) {
      fileUrl = data.url;
    } else if (data.filePath) {
      fileUrl = data.filePath;
    } else if (data.filename) {
      fileUrl = `/uploads/${data.filename}`;
    } else if (data.file) {
      fileUrl = data.file;
    } else if (typeof data === 'string') {
      fileUrl = data;
    }
    
    if (!fileUrl || typeof fileUrl !== 'string') {
      console.error('Invalid upload response structure:', data);
      throw new Error('Server returned invalid file URL. Please check server configuration.');
    }
    
    // Ensure the fileUrl starts with '/' for proper URL construction
    if (!fileUrl.startsWith('/') && !fileUrl.startsWith('http')) {
      fileUrl = '/' + fileUrl;
    }
    
    if (currentPrivateUser) {
      // Send file as private message
      const messageId = Date.now() + Math.random();
      const newMessage = { 
        from: user.username, 
        message: fileUrl, 
        timestamp: new Date(), 
        read: false, 
        id: messageId 
      };
      socket.emit('privateMessage', { to: currentPrivateUser, message: fileUrl, messageId });
      setPrivateChats(prev => ({ 
        ...prev, 
        [currentPrivateUser]: [...(prev[currentPrivateUser] || []), newMessage] 
      }));
    } else {
      // Send file to public chat
      socket.emit('sendMessage', {
        content: fileUrl,
        room: 'general'
      });
    }
  } catch (err) {
    console.error('File upload failed:', err);
    
    // More specific error messages
    let errorMessage = 'File upload failed. ';
    if (err.message.includes('Invalid file upload response')) {
      errorMessage += 'Server configuration issue. Please contact administrator.';
    } else if (err.message.includes('Upload failed: 413')) {
      errorMessage += 'File too large. Please try a smaller file.';
    } else if (err.message.includes('Upload failed: 415')) {
      errorMessage += 'File type not supported.';
    } else if (err.message.includes('Upload failed: 500')) {
      errorMessage += 'Server error. Please try again later.';
    } else {
      errorMessage += 'Please try again.';
    }
    
    alert(errorMessage);
  }
  
  // Reset file input
  e.target.value = '';
};

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !socket) return;

    if (currentPrivateUser) {
      const messageId = Date.now() + Math.random();
      const newMessage = { from: user.username, message: messageInput.trim(), timestamp: new Date(), read: false, id: messageId };
      socket.emit('privateMessage', { to: currentPrivateUser, message: messageInput.trim(), messageId });
      setPrivateChats(prev => ({ ...prev, [currentPrivateUser]: [...(prev[currentPrivateUser] || []), newMessage] }));
    } else {
      socket.emit('sendMessage', { content: messageInput.trim(), room: 'general' });
    }

    setMessageInput('');
    setShowEmojiPicker(false);
    
    if (isTyping) {
      socket.emit('typing', currentPrivateUser ? { to: currentPrivateUser, isTyping: false } : { room: 'general', isTyping: false });
      setIsTyping(false);
    }
  };

  const handleEmojiSelect = (emoji) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  // Fixed getInitials function with proper error handling
  const getInitials = (username) => {
    if (!username || typeof username !== 'string') {
      return '?'; // Return a default character for invalid usernames
    }
    return username.charAt(0).toUpperCase();
  };

  // Function to render message content with file support - FIXED VERSION
  const renderMessageContent = (content) => {
    // Add null/undefined check
    if (!content || typeof content !== 'string') {
      return <p className="text-sm text-red-500">Invalid message content</p>;
    }

    if (content.match(/\.(jpeg|jpg|png|gif)$/i)) {
      return (
        <img 
          src={`${BASE_URL}${content}`} 
          alt="sent file" 
          className="max-w-[200px] rounded cursor-pointer hover:opacity-80 transition-opacity" 
          onClick={() => window.open(`${BASE_URL}${content}`, '_blank')}
        />
      );
    } else if (content.match(/\.(pdf|docx|doc|txt|zip|rar)$/i)) {
      return (
        <a 
          href={`${BASE_URL}${content}`} 
          target="_blank" 
          rel="noreferrer" 
          className="text-blue-500 hover:text-blue-600 underline flex items-center gap-1"
        >
          📄 View Document
        </a>
      );
    } else {
      return <p className="text-sm">{content}</p>;
    }
  };
  
  const commonEmojis = ['😀', '😂', '😍', '🤔', '👍', '👎', '❤️', '😢', '😡', '🎉'];
  const getUnreadCount = (username) => {
    const userChats = privateChats[username];
    return userChats ? userChats.filter(msg => !msg.read && msg.from === username).length : 0;
  };

  return (
    <div className={`h-screen flex ${darkMode ? 'bg-gray-900' : 'bg-white'}`} style={{ colorScheme: darkMode ? 'dark' : 'light' }}>
      <div className={`w-64 border-r ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
        <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>ChatApp</h2>
            <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>
          {currentPrivateUser && (
            <button onClick={() => setCurrentPrivateUser(null)} className={`text-sm hover:underline ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
              ← Back to Public Chat
            </button>
          )}
        </div>

        <div className="h-full overflow-y-auto p-4">
          <h3 className={`font-bold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>Users</h3>
          <div className="space-y-1">
            {allUsers.map((userItem) => {
              // Additional safety check before rendering
              if (!userItem || !userItem.username || userItem.username === user.username) return null;
              
              const unreadCount = getUnreadCount(userItem.username);
              const isActive = currentPrivateUser === userItem.username;
              const isOnline = onlineUsers.includes(userItem.username);
              
              return (
                <button key={userItem.username} onClick={() => setCurrentPrivateUser(userItem.username)} className={`w-full text-left p-2 rounded-lg transition-colors flex items-center gap-2 ${isActive ? (darkMode ? 'bg-blue-800 text-blue-200' : 'bg-blue-100 text-blue-800') : (darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100')}`}>
                  <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                  <img src={userItem.avatar || '/default-avatar.png'} alt="avatar" className="w-6 h-6 rounded-full object-cover" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-300 text-gray-700'}`} style={{ display: 'none' }}>
                    {getInitials(userItem.username)}
                  </div>
                  <div className="flex-1 flex justify-between items-center">
                    <span className="truncate">{userItem.username}</span>
                    {unreadCount > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[20px] text-center ml-2">{unreadCount}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`flex flex-col flex-1 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
        <div className={`text-white p-4 flex justify-between items-center shadow-lg ${darkMode ? 'bg-blue-800' : 'bg-blue-600'}`}>
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold">{currentPrivateUser ? `Chat with ${currentPrivateUser}` : 'ChatApp - Public Chat'}</h1>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <span className="text-sm">{isConnected ? 'Connected' : 'Connecting...'}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${darkMode ? 'bg-blue-900' : 'bg-blue-700'}`}>{getInitials(user.username)}</div>
              <span>{user.username}</span>
            </div>
            <button onClick={handleLogout} className={`px-3 py-1 rounded transition-colors ${darkMode ? 'bg-blue-900 hover:bg-blue-950' : 'bg-blue-700 hover:bg-blue-800'}`}>Logout</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {currentPrivateUser ? (
            privateChats[currentPrivateUser]?.length > 0 ? (
              privateChats[currentPrivateUser].map((msg, index) => (
                <div key={msg.id || index} className={`flex ${msg.from === user.username ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${msg.from === user.username ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 shadow'}`}>
                    {renderMessageContent(msg.message)}
                    <div className="flex justify-between items-center mt-1">
                      <p className={`text-xs ${msg.from === user.username ? 'text-blue-200' : 'text-gray-500 dark:text-gray-400'}`}>{formatTime(msg.timestamp)}</p>
                      {msg.from === user.username && (
                        <div className="flex items-center ml-2">
                          <span className="text-xs text-blue-200" title="Message sent">✓</span>
                          {msg.read && <span className="text-xs text-blue-200 -ml-1" title="Message read">✓</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className={`text-center mt-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <p>Start your private conversation with {currentPrivateUser}! 💬</p>
              </div>
            )
          ) : (
            messages.length === 0 ? (
              <div className={`text-center mt-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <p>No messages yet. Start the conversation! 👋</p>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message._id} className={`flex ${message.isSystem ? 'justify-center' : message.sender.username === user.username ? 'justify-end' : 'justify-start'}`}>
                  {message.isSystem ? (
                    <div className={`text-sm px-3 py-1 rounded-full ${darkMode ? 'text-gray-400 bg-gray-600' : 'text-gray-500 bg-gray-200'}`}>{message.content}</div>
                  ) : (
                    <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${message.sender.username === user.username ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-600 text-gray-100 shadow' : 'bg-white text-gray-800 shadow')}`}>
                      {message.sender.username !== user.username && (
                        <div className="flex items-center space-x-2 mb-1">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${darkMode ? 'bg-gray-500' : 'bg-gray-300'}`}>{getInitials(message.sender.username)}</div>
                          <span className={`text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{message.sender.username}</span>
                        </div>
                      )}
                      {renderMessageContent(message.content)}
                      <p className={`text-xs mt-1 ${message.sender.username === user.username ? 'text-blue-200' : (darkMode ? 'text-gray-400' : 'text-gray-500')}`}>{formatTime(message.createdAt)}</p>
                    </div>
                  )}
                </div>
              ))
            )
          )}

          {!currentPrivateUser && typingUsers.length > 0 && (
            <div className="flex justify-start">
              <div className={`px-4 py-2 rounded-lg text-sm ${darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            </div>
          )}

          {currentPrivateUser && privateTypingUsers[currentPrivateUser] && (
            <div className="flex justify-start">
              <div className={`px-4 py-2 rounded-lg text-sm ${darkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                {currentPrivateUser} is typing...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className={`border-t p-4 ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
          {currentPrivateUser && (
            <div className={`mb-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Messaging <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>{currentPrivateUser}</strong>
            </div>
          )}
          
          {showEmojiPicker && (
            <div className={`mb-2 p-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <div className="grid grid-cols-10 gap-1">
                {commonEmojis.map((emoji, index) => (
                  <button key={index} onClick={() => handleEmojiSelect(emoji)} className={`text-xl p-1 rounded transition-colors ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSendMessage} className="flex space-x-2 items-center">
            <input type="text" value={messageInput} onChange={handleInputChange} placeholder="Type a message..." className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${darkMode ? 'border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-400' : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500'}`} disabled={!isConnected} />
            
            {/* Hidden file input */}
            <input
              type="file"
              onChange={handleFileChange}
              className="hidden"
              ref={fileInputRef}
              accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar"
            />
            
            {/* File upload button */}
            <button 
              type="button" 
              onClick={() => fileInputRef.current.click()} 
              className={`text-xl p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`} 
              title="Upload File"
              disabled={!isConnected}
            >
              📎
            </button>
            
            <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className={`text-2xl p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-100'}`} title="Add Emoji">😄</button>
            <button type="submit" disabled={!messageInput.trim() || !isConnected} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg transition-colors">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Chat;