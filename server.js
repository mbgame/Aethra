const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
// const passport = require("passport");
// const LocalStrategy = require("passport-local").Strategy;
const cookieParser = require("cookie-parser");
const session = require("express-session");
const path = require("path");
const User = require("./models/user");
const Chat = require("./models/chat");
const MongoDBStore = require('connect-mongodb-session')(session);
const bcrypt = require("bcryptjs");
const cors = require('cors');
const socketIO = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });


const MONGODB_URI = 'mongodb://127.0.0.1:27017/boogoo';

const store = new MongoDBStore({
  uri: MONGODB_URI,
  collection: 'User'
});
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

app.use(cors());
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
  secret: "mysecret",
  resave: false,
  saveUninitialized: true,
  store: store
}));
// app.use(passport.initialize());
// app.use(passport.session());

// passport.use(new LocalStrategy(User.authenticate()));
// passport.serializeUser(User.serializeUser());
// passport.deserializeUser(User.deserializeUser());

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-origin", "*")
  res.setHeader('Access-Control-Allow-Methods', "GET,POST,OPTIONS")
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
  next();
});

app.use(express.static(path.resolve(__dirname, 'build')));
app.use(express.static(path.resolve(__dirname, 'build','index.html')));

app.post("/register", async function (req, res) {
    const { username, email, password } = req.body;
  
    try {
      // Generate a salt and hash the password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      const newUser = new User({
        username,
        email,
        socketId: "",
        connected: false,
        password: hashedPassword // Store the hashed password in the user model
      });
  
      await newUser.save();
  
      res.send("success");
    } catch (err) {
      console.log(err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });


app.get("/logout", function (req, res) {
  connectedUsers.delete(req.user.username);
  req.logout();
  res.redirect("/");
});

app.post("/login", async function (req, res) {
    const { email, password } = req.body;
  
    try {
      const user = await User.findOne({ email });
  
      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }
  
      const result = await bcrypt.compare(password, user.password);
  
      if (!result) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }
  
      req.session.user = user; // Store user info in session if needed
      res.json({ success: true,user:user, message: "Login successful!" });
    } catch (err) {
      console.log(err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });
  

const connectedUsers = new Set();

app.get("/users", async function (req, res) {
    try {
      const users = await User.find().exec();
      console.log("Online users in users:", Array.from(connectedUsers));
      res.json({ users: users, onlineUsers: Array.from(connectedUsers) });
    } catch (err) {
      console.log(err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });
  

  // app.get("/chat/:id", async (req, res) => {
  //   try {
  //     const receiverId = req.params.id;
  
  //     const receiver = await User.findById(receiverId);
  
  //     res.json({ receiver: receiver, user: req.user, createPicker: null });
  //   } catch (err) {
  //     console.log(err);
  //     res.status(500).json({ success: false, message: "Internal server error" });
  //   }
  // });

  app.post("/getChat", async (req, res) => {
    try {
      const { userId } = req.body;
    
      const chatHistory = await Chat.find({
        $or: [
          { senderId: userId },
          { receiverId: userId }
        ]
      }).sort({ timestamp: 1 });
    
      res.json({ chat: chatHistory });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

io.on("connection", function(socket) {
    console.log(socket.id + " connected.");

    // Set the user's socket ID in the database
    socket.on("set-socket-id", async function(data) {
      try {
        const userId = data.userId;
        const user = await User.findById(userId);
        
        if (!user) {
          console.error("User not found:", userId);
          return;
        }
  
        user.socketId = socket.id;
        await user.save();
  
        console.log("Socket ID saved for user:", user.username);
      } catch (err) {
        console.error("Error saving user socket ID:", err);
      }
    });
  
    // Update online users array when a new socket connects
    socket.on("user-connected", async function(user) {
      if (connectedUsers.has(user.username)) {
        console.log("User already connected:", user.username);
        return;
      }
  
      socket.user = user;
      connectedUsers.add(user.username);
  
      console.log("Online users inside socket:", Array.from(connectedUsers));
  
      // Emit the user-connected event to all clients
      // io.emit('user-list-updated',  Array.from(connectedUsers)); 
      // io.emit("user-connected", { username: user.username });
    });
  
    // Remove user from online users array when socket disconnects
    socket.on("disconnect", function() {
      console.log(socket.id + " disconnected.");
      
      if (!socket.user) {
        return;
      }
      connectedUsers.delete(socket.user);
      
      // onlineUsers = onlineUsers.filter(username => username !== socket.user.username);
      console.log("Online users in disconnect:",  Array.from(connectedUsers));
    
      // Emit the user-disconnected event to all clients
      io.emit("user-disconnected", { username: socket.user.username });
    });
  
  
    socket.on("private-message", async function(data) {

      const sender = await User.findOne({ username: data.sender });
      console.log("im in private message")
      User.findOne({ username: data.receiver }).exec().then(async function(receiver) {
        const message = data.message;
        const timestamp = new Date();
        const chat = new Chat({
          senderId: sender._id,
          receiverId: receiver._id,
          message: message,
          timestamp: timestamp
        });
        await chat.save();

        console.log('sender socketid :',sender.socketId)
  
        io.to(sender.socketId).emit("private-message", { sender: data.sender, receiver: data.receiver, message: message, timestamp: timestamp });
        io.to(receiver.socketId).emit("private-message", { sender: data.sender, receiver: data.receiver, message: message, timestamp: timestamp });
      }).catch((err) => {
        console.log(err);
      });
    });
  
    socket.on("get-chat-history", async function(data) {
      try {
        const sender = await User.findOne({ username: data.sender });
        const receiver = await User.findOne({ username: data.receiver });

        const chatHistory = await Chat.find({
          $or: [
            { senderId: sender._id, receiverId: receiver._id },
            { senderId: receiver._id, receiverId: sender._id }
          ]
        }).sort({ timestamp: 1 });
  
        const formattedChatHistory = chatHistory.map(message => ({
          ...message.toObject(),
          senderId: message.senderId.toString() === sender._id.toString() ? sender.username : receiver.username,
          receiverId: message.receiverId.toString() === sender._id.toString() ? sender.username : receiver.username
        }));
    console.log('you call chat history')
        socket.emit("chat-history", { chatHistory: formattedChatHistory });
      } catch (err) {
        console.log(err);
      }
    });
      
  });

server.listen(5222, function () {
  console.log("Server started on port 5222.");
});