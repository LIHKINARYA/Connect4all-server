const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public')); // Serve static files

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store active rooms and users
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    // Join room
    socket.on('join-room', ({ roomId, userName }) => {
        socket.join(roomId);
        socket.userName = userName;
        socket.roomId = roomId;

        // Store user info
        users.set(socket.id, { userName, roomId });

        // Track users in room
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }
        rooms.get(roomId).set(socket.id, { id: socket.id, name: userName });

        console.log(`👤 ${userName} joined room: ${roomId}`);

        // Get existing users in room
        const existingUsers = Array.from(rooms.get(roomId).values())
            .filter(u => u.id !== socket.id);

        // Notify new user about existing users
        socket.emit('existing-users', existingUsers.map(u => ({
            id: u.id,
            name: u.name
        })));

        // Notify existing users about new user
        socket.to(roomId).emit('user-connected', {
            id: socket.id,
            name: userName
        });

        // Send room info
        socket.emit('room-info', {
            roomId,
            userCount: rooms.get(roomId).size,
            users: Array.from(rooms.get(roomId).values())
        });
    });

    // Handle WebRTC signaling messages
    socket.on('offer', ({ to, offer }) => {
        console.log(`📤 Sending offer from ${socket.id} to ${to}`);
        io.to(to).emit('offer', {
            from: socket.id,
            fromName: socket.userName,
            offer
        });
    });

    socket.on('answer', ({ to, answer }) => {
        console.log(`📤 Sending answer from ${socket.id} to ${to}`);
        io.to(to).emit('answer', {
            from: socket.id,
            fromName: socket.userName,
            answer
        });
    });

    socket.on('ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('ice-candidate', {
            from: socket.id,
            candidate
        });
    });

    // Handle leaving room
    socket.on('leave-room', () => {
        handleDisconnect(socket);
    });

    // Handle media state changes
    socket.on('media-state', ({ audio, video }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('peer-media-state', {
                userId: socket.id,
                audio,
                video
            });
        }
    });

    // Handle chat messages
    socket.on('chat-message', ({ message }) => {
        if (socket.roomId) {
            const timestamp = new Date().toISOString();
            io.to(socket.roomId).emit('chat-message', {
                from: socket.id,
                fromName: socket.userName,
                message,
                timestamp
            });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        handleDisconnect(socket);
        console.log(`❌ User disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error(`Error from ${socket.id}:`, error);
    });
});

function handleDisconnect(socket) {
    const roomId = socket.roomId;
    
    if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.delete(socket.id);
        
        // Notify other users
        socket.to(roomId).emit('user-disconnected', {
            id: socket.id,
            name: socket.userName
        });

        console.log(`👋 ${socket.userName} left room: ${roomId}`);

        // Clean up empty rooms
        if (room.size === 0) {
            rooms.delete(roomId);
            console.log(`🗑️  Room ${roomId} deleted (empty)`);
        } else {
            // Update remaining users about room info
            io.to(roomId).emit('room-info', {
                roomId,
                userCount: room.size,
                users: Array.from(room.values())
            });
        }
    }

    users.delete(socket.id);
}

// API endpoint to get active rooms
app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.entries()).map(([roomId, users]) => ({
        roomId,
        userCount: users.size,
        users: Array.from(users.values()).map(u => u.name)
    }));
    res.json(roomList);
});

// API endpoint to get room info
app.get('/api/rooms/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        res.json({
            roomId,
            userCount: room.size,
            users: Array.from(room.values())
        });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        activeRooms: rooms.size,
        activeUsers: users.size,
        uptime: process.uptime()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║   OpenCall Signaling Server Started   ║
    ╠════════════════════════════════════════╣
    ║   Port: ${PORT.toString().padEnd(29)} ║
    ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(19)} ║
    ╚════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = server;
