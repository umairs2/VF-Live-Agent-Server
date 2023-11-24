import { Application } from "express-ws";
import { match } from "ts-pattern";

import { LiveAgentPlatform } from "../../../shared/live-agent-platform.enum";
import { SocketEvent } from "../../../shared/socket-event.enum";
import { IntercomService } from "./intercom.service";
import { IntercomTopic } from "./intercom-topic.enum";

let intercom: IntercomService | null = null;

export const intercomRoutes = (app: Application) => {
  app.ws(
    `/${LiveAgentPlatform.INTERCOM}/user/:userID/conversation/:conversationID/socket`,
    async (ws, req) => {
      if (!intercom) {
        console.error("Intercom service not initialized.");
        return ws.close(400, "Intercom service not initialized.");
      }

      ws.on("error", (err) => {
        console.error("WebSocket Error:", err);
      });

      try {
        const { userID, conversationID } = req.params;
        await intercom.subscribeToConversation(conversationID, ws, (event) =>
          match(event.type)
            .with(SocketEvent.USER_MESSAGE, () => {
              const { message, attachmentUrls } = event.data;
              intercom?.sendUserReply(
                userID,
                conversationID,
                message,
                attachmentUrls
              );
            })
            .otherwise(() => console.warn("unknown event", event))
        );
      } catch (error) {
        console.error("WebSocket logic error:", error.message);
        ws.close(500, "Server Error");
      }
    }
  );

  app.head(`/${LiveAgentPlatform.INTERCOM}`, (_, res) => {
    if (intercom) return res.send("ok");

    try {
      intercom = new IntercomService();
      res.send("ok");
    } catch (error) {
      console.error("IntercomService initialization error:", error.message);
      res.status(500).send("invalid API key or other internal error.");
    }
  });

  app.head(`/${LiveAgentPlatform.INTERCOM}/webhook`, (_, res) =>
    res.send("ok")
  );

  app.post(`/${LiveAgentPlatform.INTERCOM}/webhook`, async (req, res) => {
    try {
      const { topic, data } = req.body;

      await match(topic)
        .with(IntercomTopic.ADMIN_ASSIGNED, () =>
          intercom?.connectAgent(data.item)
        )
        .with(IntercomTopic.ADMIN_REPLIED, () =>
          intercom?.sendAgentReply(data.item)
        )
        .with(IntercomTopic.ADMIN_CLOSED, () =>
          intercom?.disconnectAgent(data.item)
        )
        .otherwise(() => console.warn("unknown topic", topic));

      res.send("ok");
    } catch (error) {
      console.error("Webhook error:", error.message);
      res.status(500).send("Internal Server Error");
    }
  });

  app.post(`/${LiveAgentPlatform.INTERCOM}/conversation`, async (req, res) => {
    if (!intercom) {
      console.error("Intercom not initialized for conversation.");
      return res.status(400).send("intercom not initialized");
    }

    try {
      console.log("REQ BODY===");
      console.log(req.body);
      const { userID, conversationID } = await intercom.createConversation(
        req.body.userID,
        req.body.name,
        req.body.email
      );
      res.json({ userID, conversationID });
      await intercom.sendHistory(userID, conversationID, req.body.history);

      await intercom.assignConversation(conversationID);
    } catch (error) {
      console.error("Conversation creation error:", error.message);
      res.status(500).send("Failed to create conversation.");
    }
  });

  app.post(`/${LiveAgentPlatform.INTERCOM}/create-ticket`, async (req, res) => {
    if (!intercom) {
      console.error("Intercom not initialized for conversation.");
      return res.status(400).send("intercom not initialized");
    }

    try {
      const conversationId = req.body.conversationId;

      const id = conversationId;

      const resp = await fetch(
        `https://api.intercom.io/conversations/${id}/convert`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Intercom-Version": "2.10",
            Authorization:
              "Bearer dG9rOjk5NzU4NzJjXzNjZmNfNDhmYl85NzRmXzlhZGFjY2JhNjM2MzoxOjA=",
          },
          body: JSON.stringify({ ticket_type_id: "4" }),
        }
      );

      const data = await resp.json();
      console.log(data);
      res.status(200).send("Operation successful");
    } catch (error) {
      console.error("Conversation creation error:", error.message);
      res.status(500).send("Failed to create conversation.");
    }
  });
};