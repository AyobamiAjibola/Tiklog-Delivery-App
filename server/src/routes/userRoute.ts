import UserController from "../controller/UserController";
import PasswordEncoder from "../utils/PasswordEncoder";
import authenticateRouteWrapper from "../middleware/authenticateRouteWrapper";
import { Request, Response } from "express";

const passwordEncoder = new PasswordEncoder();
const userController = new UserController(passwordEncoder);

export const createUser = authenticateRouteWrapper(async (req, res) => {
    const response = await userController.createUser(req);
    res.status(response.code).json(response);
});

export const updateUserHandler = authenticateRouteWrapper( async (req, res) =>  {
    const response = await userController.updateUser(req);

    res.status(response.code).json(response);
});

export const updateUserStatusHandler = authenticateRouteWrapper( async (req, res) =>  {
    const response = await userController.updateUserStatus(req);

    res.status(response.code).json(response);
});

export const deleteUserHandler = authenticateRouteWrapper( async (req, res) =>  {
    const response = await userController.deleteUser(req);

    res.status(response.code).json(response);
});

export const getUserHandler = authenticateRouteWrapper( async (req, res) =>  {
    const response = await userController.user(req);

    res.status(response.code).json(response);
});

export const getUsersHandler = authenticateRouteWrapper( async (req, res) =>  {
    const response = await userController.users(req);

    res.status(response.code).json(response);
});

export const changeUserPasswordHandler = authenticateRouteWrapper( async (req, res) =>  {
    const response = await userController.changePassword(req);

    res.status(response.code).json(response);
});

export const resetUserPasswordHandler = async (req: Request, res: Response) =>  {
    const response = await userController.resetPassword(req);

    //@ts-ignore
    res.status(response.code).json(response);
};

export const saveUserPasswordHandler = async (req: Request, res: Response) =>  {
    const response = await userController.savePassword(req);

    res.status(response.code).json(response);
};

export const userPasswordResetCodeHandler = async (req: Request, res: Response) =>  {
    const response = await userController.enterPasswordResetCode(req);

    res.status(response.code).json(response);
};
