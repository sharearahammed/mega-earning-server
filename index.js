const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const nodemailer = require("nodemailer");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174","https://mega-earning.netlify.app"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

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
    const purchaseCoinCollection = db.collection("purchaseCoin");
    const paymentCollection = db.collection("payment");
    const submissionCollection = db.collection("workerSubmission");
    const withdrawCollection = db.collection("withdraw");

    // For localstorage
    const verifyToken = (req, res, next) => {
      console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(400).send({ message: "Invalid token" });
        }
        req.decoded = decoded;
        next();
      });

      // next();
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "Admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    // use verify TaskCreator after verifyToken
    const verifyTaskCreator = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "TaskCreator";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    // use verify TaskCreator after verifyToken
    const verifyWorker = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "Worker";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // get all withdraw
    app.get("/withdraws", verifyToken, verifyAdmin, async (req, res) => {
      const result = await withdrawCollection.find().toArray();
      res.send(result);
    });

    // post wihdraw data in db
    app.post("/wihdraws", verifyToken, verifyWorker, async (req, res) => {
      const wihdrawInfo = req.body;
      const result = await withdrawCollection.insertOne(wihdrawInfo);
      res.send(result);
    });

    app.delete("/withdraw/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await withdrawCollection.deleteOne(query);
      res.send(result);
    });

    // purchaseCoinCollection
    app.get(
      "/purchasecoin",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const result = await purchaseCoinCollection.find().toArray();
        res.send(result);
      }
    );

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // create-payment-intent
    app.post(
      "/create-payment-intent",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const price = req.body.price;
        const priceInCent = parseFloat(price) * 100;
        if (!price || priceInCent < 1) return;
        // generate clientSecret
        const { client_secret } = await stripe.paymentIntents.create({
          amount: priceInCent,
          currency: "usd",
          // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
          automatic_payment_methods: {
            enabled: true,
          },
        });
        // send client secret as response
        res.send({ clientSecret: client_secret });
      }
    );

    // get user feedback
    app.get("/feedback", async (req, res) => {
      const result = await feedbackCollection.find().toArray();
      res.send(result);
    });

    // TopEarner route
    app.get('/topEarners', async (req, res) => {
      try {
        // Step 1: Find the top 6 workers based on coins
        const topWorkers = await usersCollection.find(
          { role: 'Worker' },
          {
            projection: {
              coins: 1,
              image: 1,
              name: 1,
              email: 1,
            },
          }
        ).sort({ coins: -1 }).limit(6).toArray();
    
        if (!topWorkers.length) {
          return res.status(404).send({ message: 'No workers found' });
        }
    
        // Step 2: Count the number of completed tasks for each top worker
        const workerEmails = topWorkers.map(worker => worker.email);
        
        const completedTasks = await submissionCollection.aggregate([
          { $match: { worker_email: { $in: workerEmails }, status: 'approve' } },
          { $group: { _id: "$worker_email", count: { $sum: 1 } } }
        ]).toArray();
    
        // Step 3: Combine user data with task completion data
        const completedTasksMap = completedTasks.reduce((total, task) => {
          total[task._id] = task.count;
          return total;
        }, {});
    
        const result = topWorkers.map(worker => ({
          picture: worker.image,
          coins: worker.coins,
          completedTasks: completedTasksMap[worker.email] || 0,
        }));
    
        // Step 4: Send the combined result in the response
        res.send(result);
      } catch (error) {
        console.error('Error fetching top earners:', error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });
    


    // get all user
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    // get a user
    app.get("/users/:email", verifyToken, async (req, res) => {
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

    // patch the user role
    app.patch("/users/role/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body; // Get the new role from the request body
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: role,
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    //Decrease User Coin by patch
    app.patch("/user/coin", verifyToken, async (req, res) => {
      const withdrawInfo = req.body;
      const useremail = withdrawInfo.worker_email;
      const updatecoins = parseFloat(withdrawInfo.withdraw_coin);
      const updateResult = await usersCollection.updateOne(
        { email: useremail },
        { $inc: { coins: -updatecoins } }
      );
      res.send(updateResult);
    });

    // delete user from db
    app.delete(
      "/delete/user/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await usersCollection.deleteOne(query);
        res.send(result);
      }
    );

    // get tasks in taskCollection
    app.get("/tasks", verifyToken, async (req, res) => {
      const result = await taskCollection.find().toArray();
      res.send(result);
    });

    app.get("/tasklist/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await taskCollection.findOne(query);
      res.send(result);
    });

    // get tasks in taskCollection by email
    app.get("/task/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "taskCreator.email": email };
      const result = await taskCollection.find(query).sort({ timestamp: -1 }).toArray();
      res.send(result);
    });

    // add tasks in taskCollection
    app.post("/addTask", verifyToken, verifyTaskCreator, async (req, res) => {
      try {
        const task = req.body;

        const email = task.taskCreator.email;
        const task_quantity = task.task_quantity;
        const payable_amount = task.payable_amount;
        const totalDeduction = task_quantity * payable_amount;

        // Add totalDeduction to the task object
        task.totalDeduction = totalDeduction;

        // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
          ...task,
          timestamp: Date.now(),
      };

        const result = await taskCollection.insertOne(updateDoc,options);

        const updateResult = await usersCollection.updateOne(
          { email: email },
          {
            $inc: { coins: -totalDeduction },
          }
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

    // update task data
    app.patch(
      "/tasks/:id",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const id = req.params.id;
        const taskData = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            task_title: taskData.task_title,
            task_detail: taskData.task_detail,
            submission_info: taskData.submission_info,
          },
        };
        const result = await taskCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // delete task by id (Admin)
    app.delete(
      "/delete/task/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = taskCollection.deleteOne(query);
        res.send(result);
      }
    );

    // update submission data when approve
    app.put(
      "/submission/:id",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const submissionData = req.body;

          const userEmail = submissionData.worker_email;
          const payable_amount = parseFloat(submissionData.payable_amount);

          // Update the user's coins
          const updateResult = await usersCollection.updateOne(
            { email: userEmail },
            { $inc: { coins: payable_amount } }
          );

          // Exclude _id from submissionData
          const { _id, ...updateFields } = submissionData;

          const updateDoc = {
            $set: updateFields,
          };

          // Update the submission collection
          const result = await submissionCollection.updateOne(query, updateDoc);

          res.send({ result, updateResult });
        } catch (error) {
          console.error("Error updating submission:", error);
          res.status(500).send({ error: "Failed to update submission" });
        }
      }
    );

    // update submission data when rejected
    app.put(
      "/submissions/:id",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        try {
          const id = req.params.id;
          const query = { _id: new ObjectId(id) };
          const submissionData = req.body;

          // Exclude _id from submissionData
          const { _id, ...updateFields } = submissionData;

          const updateDoc = {
            $set: updateFields,
          };

          // Update the submission collection
          const result = await submissionCollection.updateOne(query, updateDoc);

          res.send(result);
        } catch (error) {
          console.error("Error updating submission:", error);
          res.status(500).send({ error: "Failed to update submission" });
        }
      }
    );

    // delete one task by id (taskcreator)
    app.delete(
      "/tasks/:id",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const task = await taskCollection.findOne(query);

        const email = task.taskCreator.email;
        const task_quantity = task.task_quantity;
        const payable_amount = task.payable_amount;

        // Delete the task from the taskCollection
        const deleteResult = await taskCollection.deleteOne(query);

        // Calculate the refund amount
        const refundAmount = task_quantity * payable_amount;

        // Update the user's coins
        const updateResult = await usersCollection.updateOne(
          { email: email },
          { $inc: { coins: refundAmount } }
        );

        res.send({ deleteResult, updateResult });
      }
    );

    // get all paymenthistory
    app.get("/paymentdata", verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    // get paymenthistory by email
    app.get(
      "/paymentdata/:email",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const email = req.params.email;
        const query = { userEmail: email };
        const result = await paymentCollection.find(query).toArray();
        res.send(result);
      }
    );

    // save payment info in payment collection
    app.post(
      "/paymentdata",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const paymentInfo = req.body;
        const useremail = paymentInfo.userEmail;
        const updatecoins = parseFloat(paymentInfo.cart.coins);
        const updateResult = await usersCollection.updateOne(
          { email: useremail },
          { $inc: { coins: updatecoins } }
        );

        const result = await paymentCollection.insertOne(paymentInfo);
        console.log({ result, updateResult });
        res.send({ result, updateResult });
        console.log({ result, updateResult });
      }
    );

    // post Worker Submission
    app.post("/submission", verifyToken, verifyWorker, async (req, res) => {
      const submissionInfo = req.body;
      const result = await submissionCollection.insertOne(submissionInfo);
      res.send(result);
    });

    // get worker Submission by email
    app.get(
      "/submissions",
      verifyToken,
      verifyWorker,
      async (req, res) => {
        const size = parseInt(req.query.size);
        const page = parseInt(req.query.page) - 1;
        const result = await submissionCollection.find().skip(page*size).limit(size).toArray();
        res.send(result);
      }
    );

    // get worker Submission by email
    app.get(
      "/totalSubmissions",
      verifyToken,
      verifyWorker,
      async (req, res) => {
        const result = await submissionCollection.countDocuments();
        res.send({result})
      }
    );
    

    // get worker Submission by email
    app.get(
      "/submission/:email",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const email = req.params.email;
        const query = { creator_email: email };
        const result = await submissionCollection.find(query).toArray();
        res.send(result);
      }
    );

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
