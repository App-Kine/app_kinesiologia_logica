"use strict";

var express = require("express");
var router = express.Router();
var services = require("../services/ejemplo.service");

router.post("/getData", services.getData);

module.exports = router;
