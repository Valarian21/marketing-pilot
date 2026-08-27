import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ErrorBody, IdParams, Project, ProjectCreate, ProjectUpdate } from "../../shared/schemas.js";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "../repo/projects.js";
import { writeAudit } from "../audit.js";
import type { Db } from "../db/index.js";
import { ChannelProfile } from "../../shared/schemas.js";
import { loadProfiles, saveProfiles } from "../channels.js";

export function projectRoutes(app: FastifyInstance, db: Db): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/api/mp/projects", { schema: { response: { 200: z.array(Project) } } }, async () => listProjects(db));

  r.post("/api/mp/projects", {
    schema: { body: ProjectCreate, response: { 201: Project } },
  }, async (req, reply) => {
    const project = createProject(db, req.body);
    writeAudit(db, { user: req.user, action: "project.create", entityType: "project", entityId: project.id,
      projectId: project.id, content: { name: project.name, url: project.url } });
    return reply.code(201).send(project);
  });

  r.get("/api/mp/projects/:id", {
    schema: { params: IdParams, response: { 200: Project, 404: ErrorBody } },
  }, async (req, reply) => {
    const p = getProject(db, req.params.id);
    return p ?? reply.code(404).send({ detail: "Projekt nicht gefunden." });
  });

  r.patch("/api/mp/projects/:id", {
    schema: { params: IdParams, body: ProjectUpdate, response: { 200: Project, 404: ErrorBody } },
  }, async (req, reply) => {
    const p = updateProject(db, req.params.id, req.body);
    if (!p) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    writeAudit(db, { user: req.user, action: "project.update", entityType: "project", entityId: p.id,
      projectId: p.id, content: { fields: Object.keys(req.body) } });
    return p;
  });

  // Channel profiles: where the project lives on each platform. Every channel name in the UI links here.
  r.get("/api/mp/projects/:id/profiles", { schema: { params: IdParams, response: { 200: z.array(ChannelProfile), 404: ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.id)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    return loadProfiles(db, req.params.id);
  });
  r.put("/api/mp/projects/:id/profiles", { schema: { params: IdParams, body: z.array(ChannelProfile), response: { 200: z.array(ChannelProfile), 404: ErrorBody } } }, async (req, reply) => {
    if (!getProject(db, req.params.id)) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    const out = saveProfiles(db, req.params.id, req.body);
    writeAudit(db, { user: req.user, action: "project.channels", entityType: "project", entityId: req.params.id, projectId: req.params.id, content: { count: out.filter((p) => p.url).length } });
    return out;
  });

  r.delete("/api/mp/projects/:id", {
    schema: { params: IdParams, response: { 204: z.null(), 404: ErrorBody } },
  }, async (req, reply) => {
    const p = getProject(db, req.params.id);
    if (!p) return reply.code(404).send({ detail: "Projekt nicht gefunden." });
    deleteProject(db, p.id);
    // projectId stays for traceability even though the project row is gone.
    writeAudit(db, { user: req.user, action: "project.delete", entityType: "project", entityId: p.id,
      projectId: p.id, content: { name: p.name, url: p.url } });
    return reply.code(204).send(null);
  });
}
