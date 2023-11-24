/* eslint-disable no-await-in-loop, no-restricted-syntax, xss/no-mixed-html */
import { Client as IntercomClient } from "intercom-client";
import { stripHtml } from "string-strip-html";
import { WebSocket } from "ws";
import { Operators, AssignToConversationUserType } from "intercom-client"; // Import the Operators enum

import {
  connectLiveAgent,
  disconnectLiveAgent,
  sendLiveAgentMessage,
} from "../sockets";

export class IntercomService {
  private readonly intercom = new IntercomClient({
    tokenAuth: { token: process.env.INTERCOM_TOKEN! },
  });

  private readonly conversations = new Map<string, WebSocket>();

  private send(conversationID: string, event: { type: string; data: any }) {
    const ws = this.conversations.get(conversationID);

    ws?.send(JSON.stringify(event));
  }

  public async connectAgent(conversation: any) {
    const agent = await this.intercom.admins.find({
      id: conversation.admin_assignee_id,
    });

    this.send(conversation.id, connectLiveAgent(conversation, agent));
  }

  public async disconnectAgent(conversation: any) {
    const agent = await this.intercom.admins.find({
      id: conversation.admin_assignee_id,
    });

    this.send(conversation.id, disconnectLiveAgent(conversation, agent));
    this.conversations.get(conversation.id)?.close();
    this.conversations.delete(conversation.id);
  }

  public async sendAgentReply(conversation: any) {
    const html = conversation.conversation_parts.conversation_parts
      .map((part: any) => part.body)
      .join("\n");

    this.send(conversation.id, sendLiveAgentMessage(stripHtml(html).result));
  }

  public async sendUserReply(
    userID: string,
    conversationID: string,
    message: string,
    attachmentUrls: string[]
  ) {
    await this.intercom.conversations.replyByIdAsUser({
      id: conversationID,
      intercomUserId: userID,
      body: message,
      attachmentUrls: attachmentUrls,
    });
  }

  public async assignConversation(conversationID: any) {
    try {
      const response = await this.intercom.conversations.assign({
        id: conversationID,
        adminId: "6876610",
        type: AssignToConversationUserType.TEAM,
        assigneeId: "6901898",
      });

      console.log(response);
    } catch (error) {
      console.log(error.message);
    }
  }

  public async createConversation(id: any, name: string, email: string) {
    let finalUserID = null;

    console.log(name);
    console.log(email);

    try {
      const searchResponse = await this.intercom.contacts.search({
        data: {
          query: {
            operator: Operators.AND,
            value: [
              {
                field: "email",
                operator: Operators.EQUALS,
                value: email,
              },
              {
                field: "name",
                operator: Operators.EQUALS,
                value: name,
              },
            ],
          },
          pagination: {
            per_page: 1,
          },
        },
      });

      console.log("=========================");
      console.log(searchResponse);

      if (searchResponse.total_count > 0) {
        finalUserID = searchResponse.data[0].id;
        console.log("The user exists already");
      } else {
        console.log("Creating a NEW user");
        try {
          const newUser = await this.intercom.contacts.createUser({
            name: name,
            email: email,
          });

          finalUserID = newUser.id;
        } catch (createError: any) {
          console.error("Error during user creation:", createError);

          if (createError.statusCode === 409) {
            // Extract the user ID from the error message
            const idMatch = /id=([a-f\d]+)/.exec(
              createError.body.errors[0].message
            );
            if (idMatch && idMatch[1]) {
              finalUserID = idMatch[1];
              console.log(
                "User already exists, using existing ID:",
                finalUserID
              );
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        }
      }
    } catch (e: any) {
      console.error("Error finding/creating user:", e);
      throw e;
    }

    const conversation = await this.intercom.conversations.create({
      userId: finalUserID,
      body: "<strong>A Webchat user has requested to speak with a Live Agent...</strong>",
    });

    return {
      userID: finalUserID ? finalUserID : "0",
      conversationID: conversation.conversation_id!
        ? conversation.conversation_id!
        : "0",
    };
  }

  public async sendHistory(
    userID: string,
    conversationID: string,
    history: Array<{ author: string; text: string }>
  ) {
    for (const { author, text } of history) {
      await this.intercom.conversations.replyByIdAsUser({
        id: conversationID,
        intercomUserId: userID,
        body: `<strong>${author}:</strong> ${text}`,
      });
    }
  }

  public async subscribeToConversation(
    conversationID: string,
    ws: WebSocket,
    handler: (event: { type: string; data: any }) => any
  ) {
    const conversation = await this.intercom.conversations
      .find({ id: conversationID })
      .catch(() => null);
    if (!conversation) return;

    ws.on("message", (message) => handler(JSON.parse(message.toString())));

    this.conversations.set(conversationID, ws);
  }
}
