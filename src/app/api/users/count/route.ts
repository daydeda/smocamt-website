import { NextResponse } from "next/server";
import { UsersService } from "@/modules/users/users.service";

export async function GET() {
  try {
    const countVal = await UsersService.countUsers();
    return NextResponse.json({ count: countVal });
  } catch (err) {
    console.error("Failed to fetch user count:", err);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
