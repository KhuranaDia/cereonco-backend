export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "CereOnco Community API",
    version: "0.2.0",
    description:
      "CereOnco Community API — Phase 1 (Auth/Users) + Phase 2 (Posts/Likes/Bookmarks)",
  },
  servers: [{ url: "/api", description: "Base API path" }],
  tags: [
    { name: "health", description: "Health check" },
    { name: "auth", description: "Authentication" },
    { name: "users", description: "User profiles" },
    { name: "posts", description: "Posts, likes, bookmarks" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      HealthStatus: {
        type: "object",
        required: ["status"],
        properties: { status: { type: "string" } },
      },
      UserRole: {
        type: "string",
        enum: ["patient", "caregiver", "medical_professional", "admin"],
      },
      User: {
        type: "object",
        required: ["id", "name", "email", "role", "createdAt", "updatedAt"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          email: { type: "string" },
          role: { $ref: "#/components/schemas/UserRole" },
          bio: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          avatarUrl: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      AuthResponse: {
        type: "object",
        required: ["token", "user"],
        properties: {
          token: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
        },
      },
      Post: {
        type: "object",
        required: ["id", "userId", "content", "createdAt", "updatedAt"],
        properties: {
          id: { type: "integer" },
          userId: { type: "integer" },
          content: { type: "string" },
          imageUrl: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      FeedPost: {
        type: "object",
        required: [
          "id",
          "userId",
          "content",
          "createdAt",
          "updatedAt",
          "author",
          "likeCount",
          "bookmarkCount",
          "isLiked",
          "isBookmarked",
        ],
        properties: {
          id: { type: "integer" },
          userId: { type: "integer" },
          content: { type: "string" },
          imageUrl: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          author: {
            type: "object",
            required: ["id", "name", "role"],
            properties: {
              id: { type: "integer" },
              name: { type: "string" },
              role: { $ref: "#/components/schemas/UserRole" },
              avatarUrl: { type: ["string", "null"] },
            },
          },
          likeCount: { type: "integer" },
          bookmarkCount: { type: "integer" },
          isLiked: { type: "boolean" },
          isBookmarked: { type: "boolean" },
        },
      },
      UserRegisterInput: {
        type: "object",
        required: ["name", "email", "password", "role"],
        properties: {
          name: { type: "string", minLength: 1 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          role: { $ref: "#/components/schemas/UserRole" },
        },
      },
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      UserProfileUpdate: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          bio: { type: "string" },
          location: { type: "string" },
          avatarUrl: { type: "string" },
        },
      },
      PostInput: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", minLength: 1 },
          imageUrl: { type: "string" },
        },
      },
      PostUpdate: {
        type: "object",
        properties: {
          content: { type: "string", minLength: 1 },
          imageUrl: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/healthz": {
      get: {
        operationId: "healthCheck",
        tags: ["health"],
        summary: "Health check",
        responses: {
          "200": {
            description: "Healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthStatus" },
              },
            },
          },
        },
      },
    },
    "/auth/register": {
      post: {
        operationId: "register",
        tags: ["auth"],
        summary: "Register a new user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UserRegisterInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Registered",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "400": { description: "Validation error" },
          "409": { description: "Email already in use" },
        },
      },
    },
    "/auth/login": {
      post: {
        operationId: "login",
        tags: ["auth"],
        summary: "Login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "Logged in",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthResponse" },
              },
            },
          },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/logout": {
      post: {
        operationId: "logout",
        tags: ["auth"],
        summary: "Logout",
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/users/me": {
      get: {
        operationId: "getMe",
        tags: ["users"],
        summary: "Get current user profile",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "User",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      patch: {
        operationId: "updateMe",
        tags: ["users"],
        summary: "Update current user profile",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UserProfileUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/users/{id}": {
      get: {
        operationId: "getUser",
        tags: ["users"],
        summary: "Get a user's public profile",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "User",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
    },
    "/posts": {
      get: {
        operationId: "getFeed",
        tags: ["posts"],
        summary: "Get feed (all posts, newest first)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", default: 0 },
          },
        ],
        responses: {
          "200": {
            description: "Feed",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/FeedPost" },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createPost",
        tags: ["posts"],
        summary: "Create a post",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Post" },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/posts/{id}": {
      get: {
        operationId: "getPost",
        tags: ["posts"],
        summary: "Get a single post",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "Post",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FeedPost" },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
      patch: {
        operationId: "updatePost",
        tags: ["posts"],
        summary: "Update own post",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PostUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Post" },
              },
            },
          },
          "403": { description: "Forbidden" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        operationId: "deletePost",
        tags: ["posts"],
        summary: "Delete own post",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "204": { description: "Deleted" },
          "403": { description: "Forbidden" },
          "404": { description: "Not found" },
        },
      },
    },
    "/posts/{id}/like": {
      post: {
        operationId: "likePost",
        tags: ["posts"],
        summary: "Like a post",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "Liked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    liked: { type: "boolean" },
                    likeCount: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: "unlikePost",
        tags: ["posts"],
        summary: "Unlike a post",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": { description: "Unliked" },
        },
      },
    },
    "/posts/{id}/bookmark": {
      post: {
        operationId: "bookmarkPost",
        tags: ["posts"],
        summary: "Bookmark a post",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": { description: "Bookmarked" },
        },
      },
      delete: {
        operationId: "unbookmarkPost",
        tags: ["posts"],
        summary: "Remove bookmark",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": { description: "Bookmark removed" },
        },
      },
    },
  },
};
