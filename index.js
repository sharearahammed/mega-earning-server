const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const nodemailer = require("nodemailer");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.netgysa.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // Send a ping to confirm a successful connection

    const db = client.db("megaEarningDB");
    const usersCollection = db.collection('users')

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      // console.log("user for token", user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });
    // Logout
    app.post("/logout", async (req, res) => {
      const user = req.body;
      // console.log("logging out", user);
      res
        .clearCookie("token", { ...cookieOptions, maxAge: 0 })
        .send({ success: true });
    });

    // save a user data in db
    app.put('/users', async (req, res) => {
        const user = req.body
  
        const query = { email: user?.email }
        // check if user already exists in db
        const isExist = await usersCollection.findOne(query)
        if (isExist) {
          if (user.status === 'Requested') {
            // if existing user try to change his role
            const result = await usersCollection.updateOne(query, {
              $set: { status: user?.status },
            })
            return res.send(result)
          } else {
            // if existing user login again
            return res.send(isExist)
          }
        }
  
        // save user for the first time
        const options = { upsert: true }
        const updateDoc = {
          $set: {
            ...user,
            timestamp: Date.now(),
          },
        }
        const result = await usersCollection.updateOne(query, updateDoc, options)
        res.send(result)
      })



    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from MegaEarning Server..");
});

app.listen(port, () => {
  console.log(`MegaEarning is running on port ${port}`);
});
