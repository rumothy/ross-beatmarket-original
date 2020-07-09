const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const fs = require("fs");
const keys = require("./private/keys");

const mongoose = require("mongoose");
// const routes = require("./routes");

const passport = require("passport");
const router = express.Router();
const db = require("./models");
var isAuthenticated = require("./config/middleware/isAuthenticated");

const path = require("path");
const bodyParser = require("body-parser");

const beatsController = require("./controllers/beatsController");
const producersController = require("./controllers/producersController");
const customersController = require("./controllers/customersController");
const licensesController = require("./controllers/licensesController");
const usersController = require("./controllers/usersController");

const PORT = process.env.PORT || 3001;

const app = express();
// Define middleware here
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(bodyParser.json());

// Serve up static assets (usually on heroku)
if (process.env.NODE_ENV === "production") {
  app.use(express.static("client/build"));
}
// Add routes, both API and view
// app.use(routes);

// Connect to the Mongo DB
const dbUri = "mongodb://localhost/beatmarketdb";
mongoose.connect(process.env.MONGODB_URI || dbUri);

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: function(req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

AWS.config.update({
  accessKeyId: process.env.S3_KEY || keys.iam_access_id,
  secretAccessKey: process.env.S3_SECRET || keys.iam_secret,
  region: keys.bucket_region
});

const s3 = new AWS.S3();

app.post("/api/files", upload.single("file"), function(req, res) {
  uploadFile(req.file.path, req.file.filename, res, req.headers.referer);
});

app.get("/api/files/:filename", (req, res) => {
  retrieveFile(req.params.filename, res);
});

app.get("/api/files/", (req, res) => {
  const getParams = {
    Bucket: keys.bucket_name,
    MaxKeys: 20
  };

  s3.listObjectsV2(getParams, (err, data) => {
    if (err) {
      return res.status(400).send({ success: false, err: err });
    }
    res.json(data.Contents);
  });
});

// https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/requests-using-stream-objects.html
app.get("/api/audio/:filename", (req, res) => {
  const getParams = {
    Bucket: keys.bucket_name,
    Key: req.params.filename
  };
  let s3Stream = s3.getObject(getParams).createReadStream();
  s3Stream.on("error", err => {
    console.error(err);
  });

  s3Stream
    .pipe(res)
    .on("error", err => {
      console.error("File Stream:", err);
    })
    .on("close", () => {
      console.log("Done.");
    });
});

function uploadFile(source, filename, res, referer) {
  console.log("preparing to upload...");
  fs.readFile(source, function(err, filedata) {
    if (!err) {
      const putParams = {
        Bucket: keys.bucket_name,
        Key: filename,
        Body: filedata
      };
      s3.putObject(putParams, function(err, data) {
        if (err) {
          console.log("Could not upload the file", err);
          return res.send({ success: false });
        } else {
          fs.unlink(source, () => {});
          return res.redirect("/producerAdmin/" + getProducerId(referer));
        }
      });
    } else {
      console.log({ err: err });
    }
  });
}

function getProducerId(referer) {
  // const referer = "http://localhost:3000/producerAdmin/5e66ad42768dd5009dd161b1";
  const refererArray = referer.split("/");
  return refererArray.pop();
}

function retrieveFile(filename, res) {
  const getParams = {
    Bucket: keys.bucket_name,
    Key: filename
  };
  s3.getObject(getParams, function(err, data) {
    if (err) {
      return res.status(400).send({ success: false, err: err });
    } else {
      return res.send(data.Body);
    }
  });
}

// -------------------------------------------------------
// Beat Routing
app.get("/api/beats", beatsController.findAll);
app.get("/api/beats/:id", beatsController.findById);
app.post("/api/beats", beatsController.create);
app.delete("/api/beats/:id", beatsController.remove);

// Customer routing
app.get("/api/customers/:id", customersController.findById);
app.post("/api/customers", customersController.create);

// License Routing
app.get("/api/licenses", licensesController.findAll);

// Producer Routing
app.get("/api/producers/", producersController.findAll);
app.get("/api/producers/:id", producersController.findById);

// mock User Routing
app.get("/api/users/:id", usersController.findById);
app.post("/api/users", usersController.create);

// ------------------------------------------------------- end Routing

router.post("/api/register", function(req, res) {
  console.log("registering user");

  //Do password validation here before attempting to register user, such as checking for password length, captial letters, special characters, etc.

  db.User.register(
    new db.User({ username: req.body.username, email: req.body.email }),
    req.body.password,
    function(err, user) {
      if (err) {
        console.log(err);
        return res.json(err);
      }
      passport.authenticate("local")(req, res, function(data) {
        res.json(req.user);
      });
    }
  );
});

router.post("/api/login", function(req, res, next) {
  passport.authenticate("local", function(err, user, info) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.json(info);
    }
    req.logIn(user, function(err) {
      if (err) {
        return next(err);
      }
      return res.json(user);
    });
  })(req, res, next);
});

router.get("/api/logout", function(req, res) {
  req.logout();
  res.json({ message: "logged out" });
});

router.get("/api/user", function(req, res) {
  console.log("available username");
  if (req.query.username) {
    db.User.find({ username: req.query.username })
      .then(result => {
        res.json({ length: result.length });
      })
      .catch(err => res.status(422).json(err));
  } else {
    res.json({ message: "no username entered for query" });
  }
});

router.get("/api/authorized", isAuthenticated, function(req, res) {
  res.json(req.user);
});

// ------------------------------------------------------- end Routing
app.use(function(req, res) {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

// Start the API server
app.listen(PORT, function() {
  console.log(`🌎 ==> API Server listening on PORT ${PORT}!`);
});
