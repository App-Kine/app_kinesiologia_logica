"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/auth.service");

router.post("/login", services.login);

module.exports = router;
