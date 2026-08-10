const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { getIsConnected } = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// In-memory fallback user store if MongoDB is offline
const inMemoryUsers = [];

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const isDbConnected = getIsConnected();
    let existingUser = null;

    if (isDbConnected) {
      existingUser = await User.findOne({ email: email.toLowerCase() });
    } else {
      existingUser = inMemoryUsers.find(u => u.email === email.toLowerCase());
    }

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let newUser;

    if (isDbConnected) {
      const created = await User.create({ email: email.toLowerCase(), password: hashedPassword });
      newUser = { id: created._id.toString(), email: created.email };
    } else {
      const memUser = { id: Date.now().toString(), email: email.toLowerCase(), password: hashedPassword };
      inMemoryUsers.push(memUser);
      newUser = { id: memUser.id, email: memUser.email };
    }

    const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: newUser
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const isDbConnected = getIsConnected();
    let user = null;

    if (isDbConnected) {
      user = await User.findOne({ email: email.toLowerCase() });
    } else {
      user = inMemoryUsers.find(u => u.email === email.toLowerCase());
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userId = user._id ? user._id.toString() : user.id;
    const token = jwt.sign({ id: userId, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      message: 'Login successful',
      token,
      user: { id: userId, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
