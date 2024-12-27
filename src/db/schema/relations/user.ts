import { relations } from "drizzle-orm";
import { users } from "../tables/user";
import { usersToLikes } from "../tables/userToLikes";

export const userRelations = relations(users, ({ many }) => ({
	likes: many(usersToLikes),
}));
