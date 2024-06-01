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

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const usersCollection = db.collection("users");
    const taskCollection = db.collection("tasks");
    const feedbackCollection = db.collection("feedback");

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

    // get user feedback
    app.get("/feedback", async (req, res) => {
      const result = await feedbackCollection.find().toArray();
      res.send(result);
    });

    // get a user
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });
    // save a user data in db
    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user?.email };
      // check if user already exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        // if existing user login again
        return res.send(isExist);
      }

      let initialCoinValue = 0;
      if (user.role === "Worker") {
        initialCoinValue = 10;
      } else if (user.role === "TaskCreator") {
        initialCoinValue = 50;
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          coins: initialCoinValue,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // add tasks in taskCollection
    app.post("/addTask", async (req, res) => {
      try {
        const task = req.body;
        const result = await taskCollection.insertOne(task);

        const email = task.taskCreator.email;
        const task_quantity = task.task_quantity;
        const payable_amount = task.payable_amount;
        console.log({ email, task_quantity, payable_amount });
        const totalDeduction = task_quantity * payable_amount;

        const updateResult = await usersCollection.updateOne(
          { email: email },
          { $inc: { coins: -totalDeduction } }
        );
        if (updateResult.matchedCount === 0) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({ result, updateResult });
      } catch (err) {
        console.error("Error adding task or updating user's coins:", err);
        res.status(500).send({ error: "An error occurred" });
      }
    });
    // get tasks in taskCollection
    app.get("/task/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "taskCreator.email": email };
      const result = await taskCollection.find(query).toArray();
      res.send(result);
    });

    // delete one task by id
    app.delete("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await taskCollection.deleteOne(query);
      res.send(result);
    });

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
