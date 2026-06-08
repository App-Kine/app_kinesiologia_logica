"use strict";

var express = require("express");
var baseService = require("../services/base.service");
var router = express.Router();

router.post("/reload", baseService.reload);

module.exports = router;
