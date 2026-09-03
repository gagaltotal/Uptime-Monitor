const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/monitors', require('./monitor.routes'));
router.use('/incidents', require('./incident.routes'));
router.use('/status-pages', require('./statusPage.routes'));
router.use('/notification-channels', require('./notification.routes'));
router.use('/public', require('./public.routes'));

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

module.exports = router;
