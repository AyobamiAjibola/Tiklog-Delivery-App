import { Request } from 'express';
import { appEventEmitter } from '../services/AppEventEmitter';
import { HasPermission, TryCatch } from "../decorators";
import HttpStatus from "../helpers/HttpStatus";
import CustomAPIError from "../exceptions/CustomAPIError";
import datasources from  '../services/dao';
import { appCommonTypes } from '../@types/app-common';
import Joi from 'joi';
import { $deliverySchema, $editDeliverySchema, IDeliveryModel } from '../models/Delivery';
import Generic from '../utils/Generic';
import {
    PENDING,
    CREATE_DELIVERY,
    BIKE_SPEED,
    CAR_SPEED,
    BUS_SPEED,
    PRICE_PER_KM_BIKE,
    PRICE_PER_KM_CAR,
    PRICE_PER_KM_BUS,
    MAX_DISTANCE,
    AVERAGE_SPEED,
    AVERAGE_PRICE_PER_KM,
    DELIVERED,
    ON_TRANSIT,
    CANCELED,
    EDIT_DELIVERY
} from '../config/constants';
import HttpResponse = appCommonTypes.HttpResponse;
import { CUSTOMER_PERMISSION, DELETE_DELIVERY, MANAGE_ALL, MANAGE_SOME, READ_DELIVERY } from '../config/settings';
import RabbitMqService from '../services/RabbitMqService';
import RiderLocation from '../models/RiderLocation';
import { Socket } from 'socket.io';
import RedisService from '../services/RedisService';

const redisService = new RedisService();
const rabbitMqService = new RabbitMqService();

export default class DeliveryController {


    /***
     * @name delivery
     * @req This requests for the user id 
     * @desc The api calculates speed and fee based on
     * @desc the vehicle selected. then it calculates the 
     * @desc distance between the sender and recipient.
     * @desc it uses the distance gotten to calculate
     * @desc the delivery fee per kilometer
     * 
     */
    @TryCatch
    @HasPermission([CUSTOMER_PERMISSION])
    public async delivery (req: Request) {
        const delivery = await this.doDelivery(req);

        appEventEmitter.emit(CREATE_DELIVERY, delivery);

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: 'Delivery was successful',
            result: delivery
        };
      
        return Promise.resolve(response);
    
    };

    /****
     * @name editDelivery
     * @req delivery id as params
     * @desc deliveries can be edited only when 
     * @desc its pending. When location is edited
     * @desc it recalculates the delivery fee and
     * @desc either substract or add to the wallet
     * 
     */
    @TryCatch
    @HasPermission([CUSTOMER_PERMISSION])
    public async editDelivery (req: Request) {
        const delivery = await this.doEditDelivery(req);

        appEventEmitter.emit(EDIT_DELIVERY, delivery);

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: 'Delivery updated successfully',
            result: delivery
        };
      
        return Promise.resolve(response);
    
    };

    /**
     * 
     * @param req delivery id 
     * @desc gets a single delivery
     * @returns an object of the edited delivery
     * 
     */
    @TryCatch
    @HasPermission([CUSTOMER_PERMISSION, MANAGE_ALL, MANAGE_SOME, READ_DELIVERY])
    public async getSingleDelivery(req: Request) {

        const deliveryId = req.params.deliveryId

        const delivery = await datasources.deliveryDAOService.findById(deliveryId);

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: HttpStatus.OK.value,
            result: delivery,
        };
      
        return Promise.resolve(response);
    };

    /**
     * 
     * @param req user id 
     * @returns deliveries initiated by a customer
     */
    @TryCatch
    @HasPermission([CUSTOMER_PERMISSION, READ_DELIVERY, MANAGE_ALL, MANAGE_SOME])
    public async getDeliveries(req: Request) {

        //@ts-ignore
        const customerId = req.user._id

        const deliveries = await datasources.deliveryDAOService.findAll({
            customer: customerId
        });

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: HttpStatus.OK.value,
            results: deliveries,
        };
      
        return Promise.resolve(response);
    };

    /**
     * 
     * @returns all the deliveries in the database
     */
    @TryCatch
    @HasPermission([MANAGE_ALL, MANAGE_SOME, READ_DELIVERY])
    public async getDeliveriesAll(req: Request) {

        const deliveries = await datasources.deliveryDAOService.findAll({});

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: HttpStatus.OK.value,
            results: deliveries,
        };
      
        return Promise.resolve(response);
    };

    /**
     * 
     * @param req deliveryID
     * @desc deletes a single delivery 
     */
    @TryCatch
    @HasPermission([MANAGE_ALL, CUSTOMER_PERMISSION, DELETE_DELIVERY])
    public async deleteDelivery(req: Request) {

        const deliveryId = req.params.deliveryId

        await datasources.deliveryDAOService.deleteById(deliveryId);

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: 'Delivery deleted successfully'
        };
      
        return Promise.resolve(response);
    };

    /***
     * @name findRiders
     * @desc finds riders that are located 1000km
     * @desc around a customer
     * @returns the rider data closest to the customer
     * @returns the rider time of arrival
     */
    @TryCatch
    public async findRiders(req: Request) {

        //@ts-ignore
        const customerId = req.user._id

        const delivery = await datasources.deliveryDAOService.findAll(
            {customer: customerId}
        );
        if(!delivery)
            return Promise.reject(CustomAPIError.response('Delivery does not exist', HttpStatus.NOT_FOUND.code));
        
        const lastDelivery = delivery[delivery.length - 1];

        const customerLongitude = lastDelivery.senderLocation.coordinates[0];
        const customerLatitude = lastDelivery.senderLocation.coordinates[1];

        const maxDistance = MAX_DISTANCE

        const riders = await RiderLocation.aggregate([
            {
              $geoNear: {
                near: {
                  type: 'Point',
                  coordinates: [customerLongitude, customerLatitude],
                },
                distanceField: 'distance',
                maxDistance,
                spherical: true,
              },
            },
            {
                $sort: { distance: 1 }
            }
        ]).exec();
        if(!riders.length)
            return Promise.reject(CustomAPIError.response('No riders available at the moment', HttpStatus.NOT_FOUND.code));

        let rider: any = null;
        for(const riderLoc of riders) {
            const _rider = await datasources.riderDAOService.findById(riderLoc.rider);

            if ((_rider?.status === 'online' && _rider?.active) && rider === null) {
                rider = _rider;
                break;
            }
        }
        if(rider === null)
            return Promise.reject(CustomAPIError.response('No rider is currently online', HttpStatus.NOT_FOUND.code));

        const vehicle = await datasources.vehicleDAOService.findByAny({
            rider: rider?._id
        })

        let speedInKmPerHour = 0;
        if(vehicle){
            //checks speed and fee based on vehicle selected
            if(vehicle?.vehicleType === 'bike') {
                speedInKmPerHour += BIKE_SPEED
            } else if(vehicle?.vehicleType === 'car') {
                speedInKmPerHour += CAR_SPEED
            } else if(vehicle?.vehicleType === 'bus') {
                speedInKmPerHour += BUS_SPEED
            } else {
                speedInKmPerHour += AVERAGE_SPEED
            };
        }

        let estimatedTimeToSender = 0
        riders.forEach(elem => {
            const distanceKm = elem.distance / 1000;
            estimatedTimeToSender += distanceKm / speedInKmPerHour
        });

        const hours = Math.floor(estimatedTimeToSender);
        const minutes = Math.round((estimatedTimeToSender - hours) * 60);

        const pinRiderLoc = await datasources.riderLocationDAOService.findByAny({
            rider: rider._id
        });

        const riderData = {
            location: {
                longitude: pinRiderLoc?.location.coordinates[0],
                latitude: pinRiderLoc?.location.coordinates[1]
            },
            phone: rider.phone,
            email: rider.email,
            _id: rider._id,
            status: rider.status,
            firstName: rider.firstName,
            lastName: rider.lastName,
            gender: rider.gender
        };

        const redisData = JSON.stringify(riderData)
        redisService.saveToken('riderInfo', redisData, 3600)

        let arrivalTime = 0
        if(minutes <= 2) {
            arrivalTime += 2
        } else {
            arrivalTime += minutes
        }

        const response: HttpResponse<any> = {
            code: HttpStatus.OK.code,
            message: `Rider will arrive in ${arrivalTime}min`,
            result: riderData
        };
      
        return Promise.resolve(response);
        
    }

    // @TryCatch
    // private async sendNotificationToDriver(req: Request)  {

        
    // }

    // @TryCatch
    // public async requestRider(req: Request) {

    // }

    @TryCatch
    public async packageRequest(req: Request, socket: Socket<any, any, any, any>) {
        await rabbitMqService.connectToRabbitMQ()

        const rider = await redisService.getToken('riderInfo');
        let packageRequest: any = null
        if(rider) {
            packageRequest = rider
        }

        await rabbitMqService.submitPackageRequest(packageRequest, socket)
    }

    @TryCatch
    public async sendDriverResponse(req: Request) {
        await rabbitMqService.connectToRabbitMQ()
        const driverResponse = {
            driverId: 123,
            availability: true
        };

        await rabbitMqService.sendDriverResponse(driverResponse);

        await rabbitMqService.disconnectFromRabbitMQ();
    }

    private async doDelivery (req: Request) {

        //@ts-ignore
        const customerId = req.user._id

        const { error, value } = Joi.object<any>($deliverySchema).validate(req.body);
        if(error) return Promise.reject(CustomAPIError.response(error.details[0].message, HttpStatus.BAD_REQUEST.code));
        
        //checks speed and fee based on vehicle selected
        let speed = 0;
        let fee = 0;
        if(value.vehicle === 'bike') {
            speed += BIKE_SPEED
            fee += PRICE_PER_KM_BIKE
        } else if(value.vehicle === 'car') {
            speed += CAR_SPEED
            fee += PRICE_PER_KM_CAR
        } else if(value.vehicle === 'bus') {
            speed += BUS_SPEED
            fee += PRICE_PER_KM_BUS
        } else {
            speed += AVERAGE_SPEED
            fee  += AVERAGE_PRICE_PER_KM
        };

        const distance = Generic
            .location_difference(
                value.senderLat,
                value.senderLon,
                value.recipientLat,
                value.recipientLon,
                speed //estimated speed of the rider
            );

        const _deliveryFee = +distance.distance.toFixed(2) * fee;

        const wallet = await datasources.walletDAOService.findByAny({
            customer: customerId
        });
        if(!wallet)
            return Promise.reject(CustomAPIError.response('Add funds to wallet before initiating a delivery', HttpStatus.NOT_FOUND.code));
        
        if(wallet.balance < _deliveryFee)
            return Promise.reject(CustomAPIError.response('Wallet is low on cash, please fund wallet.', HttpStatus.BAD_REQUEST.code));

        const deliveryTime = `${distance.hours}hrs:${distance.minutes}min`;

        const deliveryValue: Partial<IDeliveryModel> = {
            ...value,
            senderLocation: {
                type: 'Point',
                coordinates: [value.senderLon, value.senderLat]
            },
            recipientLocation: {
                type: 'Point',
                coordinates: [value.recipientLon, value.recipientLat],
            },
            status: PENDING,
            deliveryFee: _deliveryFee.toFixed(2),
            customer: customerId,
            estimatedDeliveryTime: deliveryTime
        };

        const delivery  = await datasources.deliveryDAOService.create(deliveryValue as IDeliveryModel);

        if(delivery) {
            const amount = wallet && wallet.balance - delivery.deliveryFee;

            const walletBalance = {
                balance: amount
            };

            await datasources.walletDAOService.update(
                { _id: wallet._id },
                walletBalance
            )
        };

        return delivery;
    }

    private async doEditDelivery (req: Request) {

        //@ts-ignore
        const deliveryId = req.params.deliveryId;

        const { error, value } = Joi.object<any>($editDeliverySchema).validate(req.body);
        if(error) return Promise.reject(CustomAPIError.response(error.details[0].message, HttpStatus.BAD_REQUEST.code));
        
        const _delivery = await datasources.deliveryDAOService.findById(deliveryId);
        if(!_delivery)
            return Promise.reject(CustomAPIError.response('Delivery does not exist', HttpStatus.NOT_FOUND.code));
            
        if(_delivery.status !== PENDING)
            return Promise.reject(CustomAPIError.response('Delivery can not be edited', HttpStatus.BAD_REQUEST.code));

        //checks speed and fee based on vehicle selected
        let speed = 0;
        let fee = 0;
        if(value.vehicle === 'bike') {
            speed += BIKE_SPEED
            fee += PRICE_PER_KM_BIKE
        } else if(value.vehicle === 'car') {
            speed += CAR_SPEED
            fee += PRICE_PER_KM_CAR
        } else if(value.vehicle === 'bus') {
            speed += BUS_SPEED
            fee += PRICE_PER_KM_BUS
        } else {
            speed += AVERAGE_SPEED
            fee  += AVERAGE_PRICE_PER_KM
        };

        const distance = Generic
            .location_difference(
                value.senderLat,
                value.senderLon,
                value.recipientLat,
                value.recipientLon,
                speed //estimated speed of the rider
            );

        const _deliveryFee = +distance.distance.toFixed(2) * fee;

        const wallet = await datasources.walletDAOService.findByAny({
            customer: _delivery.customer
        });

        if(!wallet)
            return Promise.reject(CustomAPIError.response('Add funds to wallet before initiating a delivery', HttpStatus.NOT_FOUND.code));
        
        let deliveryDiff: number = 0;
        if(_delivery.deliveryFee > _deliveryFee) {
            deliveryDiff += _delivery.deliveryFee - _deliveryFee
        } else {
            deliveryDiff += _delivery.deliveryFee - _deliveryFee
        }

        const isNegative = !isNaN(deliveryDiff) && deliveryDiff < 0; //check if deliveryDiff is a negative number

        if(isNegative && Math.abs(deliveryDiff) > wallet.balance)
            return Promise.reject(CustomAPIError.response('Wallet is low on cash, please fund wallet', HttpStatus.BAD_REQUEST.code));

        const deliveryTime = `${distance.hours}hrs:${distance.minutes}min`;

        const deliveryValue: Partial<IDeliveryModel> = {
            ...value,
            senderLocation: {
                type: 'Point',
                coordinates: [value.senderLon, value.senderLat]
            },
            recipientLocation: {
                type: 'Point',
                coordinates: [value.recipientLon, value.recipientLat],
            },
            status: PENDING,
            deliveryFee: _deliveryFee.toFixed(2),
            customer: _delivery.customer,
            estimatedDeliveryTime: deliveryTime
        };

        const delivery  = await datasources.deliveryDAOService.updateByAny(
            { _id: _delivery._id },
            deliveryValue
        );

        if(delivery) {
            const amount = wallet && wallet.balance + deliveryDiff;

            const walletBalance = {
                balance: amount.toFixed(2)
            };

            await datasources.walletDAOService.update(
                { _id: wallet._id },
                walletBalance
            )
        };

        return delivery;
    }

}