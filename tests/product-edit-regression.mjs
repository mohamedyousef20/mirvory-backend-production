import assert from 'node:assert/strict';
import mongoose from 'mongoose';
// Install test-only dependency: npm install --no-save mongodb-memory-server
const { MongoMemoryServer } = await import(process.env.MONGO_TEST_MODULE || 'mongodb-memory-server');
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import { updateProduct } from '../controllers/product.controller.js';
import { productEditFields } from '../utils/productEdit.js';
const db = await MongoMemoryServer.create();
await mongoose.connect(db.getUri());
const admin = new mongoose.Types.ObjectId();
const category = await Category.create({name:'Fixture category'});
const color = { name:'Black',value:'#000000',image:'https://example.com/old.jpg',sizes:[{size:'41',quantity:2}] };
const doc = await Product.create({ seller:admin,title:'Fixture product',description:'Fixture description',category:category._id,price:100,colors:[color] });
async function edit(body, user={_id:admin,role:'super_admin'}) {
 let out, err, code;
 await updateProduct({params:{id:String(doc._id)},body,user},{status(n){code=n;return this},json(v){out=v}},e=>{err=e});
 return {out,err,code};
}
try {
 let r=await edit({title:'Changed',description:'Changed description',price:200,discountPercentage:25,category:String(category._id),tags:'a, b, a',isTrusted:true,isFeatured:true,status:'available',isApproved:true,sellerPercentage:120,videoUrl:'https://example.com/video',rejectionReason:'',colors:[{...color,name:'Navy',value:'#112233',image:'https://example.com/new.jpg',sizes:[{size:'42',quantity:7}]}]});
 assert.equal(r.code,200); assert.equal(r.out.product.discountedPrice,150); assert.equal(r.out.product.quantity,7); assert.equal(r.out.product.sellerPercentage,120); assert.deepEqual(r.out.product.tags,['a','b']); assert.equal(r.out.product.isTrusted,true); assert.equal(r.out.product.isApproved,true);
 r=await edit({videoUrl:'',status:'pending'}); assert.equal(r.out.product.videoUrl,'');assert.equal(r.out.product.isApproved,false);
 for(const bad of [{price:-1},{discountPercentage:101},{sellerPercentage:'bad'},{status:'nonsense'},{isApproved:'wrong'},{category:String(new mongoose.Types.ObjectId())},{colors:[{...color,sizes:[{size:'41',quantity:-1}]}]}]) assert((await edit(bad)).err);
 const before=await Product.findById(doc._id).lean();
 r=await edit({price:0,colors:[{...color,image:'https://example.com/invalid.jpg'}]});assert(r.err);
 assert.deepEqual((await Product.findById(doc._id).lean()).colors,before.colors);
 r=await edit({status:'deleted'}); assert.equal(r.out.product.status,'deleted');
 r=await edit({isApproved:true}); assert.equal(r.out.product.status,'available');
 r=await edit({title:'Attack'}, {_id:new mongoose.Types.ObjectId(),role:'seller'}); assert(r.err);
 const fields=productEditFields({isApproved:true,isTrusted:true,isFeatured:true,sellerPercentage:1,status:'available',brand:'ok',tags:['ok'],seller:String(admin),sold:500,ratings:{average:5}},false);
 assert.deepEqual(fields,{brand:'ok',tags:['ok']});
 console.log('PASS: stored edits, derived price/stock, tags, super_admin flags/payout, video clearing, approval/hide/restore, invalid input rejected, failed edit preserves old data, unauthorized seller rejected, privileged fields ignored for sellers. Local temporary database only.');
} finally {await mongoose.disconnect();await db.stop()}
